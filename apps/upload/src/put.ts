import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import type { Repository } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv, resolveUploadTokenSigner } from "@agent-paste/rotation";
import {
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  parseWorkspaceBlobObjectKey,
  ReadableBodyTooLargeError,
} from "@agent-paste/storage";
import type { SignedUploadPayload } from "@agent-paste/tokens/upload-url";
import { getBoundResponders, type SignedUploadUrlPrincipal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "./env.js";
import { uploadDatabase } from "./upload-db.js";

const UPLOAD_FILE_PATH_MARKER = "/files/";

function parseUploadObjectKey(payload: SignedUploadPayload): {
  blobKeyParts: ReturnType<typeof parseWorkspaceBlobObjectKey>;
  revisionKeyParts: ReturnType<typeof parseRevisionFileObjectKey>;
} | null {
  const blobKeyParts = payload.sha256 ? parseWorkspaceBlobObjectKey(payload.key) : null;
  const revisionKeyParts = payload.sha256 ? null : parseRevisionFileObjectKey(payload.key);
  if (payload.sha256) {
    return blobKeyParts?.workspaceId === payload.wid && blobKeyParts.sha256 === payload.sha256
      ? { blobKeyParts, revisionKeyParts }
      : null;
  }
  return revisionKeyParts?.path === payload.path ? { blobKeyParts, revisionKeyParts } : null;
}

export function uploadFilePath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const markerIndex = pathname.indexOf(UPLOAD_FILE_PATH_MARKER);
  if (markerIndex === -1) {
    return "";
  }
  const encodedPath = pathname.slice(markerIndex + UPLOAD_FILE_PATH_MARKER.length);
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return "";
  }
}

export async function verifyUploadToken(token: string | null, env: Env): Promise<SignedUploadPayload | null> {
  if (!token) {
    return null;
  }
  const signer = resolveUploadTokenSigner(env);
  return signer ? signer.verify(token) : null;
}

/**
 * A signed PUT URL stays valid until its token expiry, which can outlast the
 * point where the session is finalized or otherwise closed. Without this guard a
 * replayed PUT would overwrite the already-published encrypted object. Only a
 * `pending`, unexpired session is writable; everything else (finalized, expired,
 * missing, or an unreachable database) is rejected fail-closed.
 */
async function guardWritableSession(
  context: AppContext,
  db: Repository,
  payload: SignedUploadPayload,
): Promise<Response | null> {
  const session = await db.getUploadSessionState({ workspaceId: payload.wid, sessionId: payload.sid });
  if (!session) {
    return getBoundResponders(context).respondError("upload_session_not_found");
  }
  const expired = session.status === "expired" || new Date(session.expiresAt).getTime() <= Date.now();
  if (expired || session.status !== "pending") {
    return getBoundResponders(context).respondError("upload_session_expired");
  }
  return null;
}

export async function putUploadFile(
  context: AppContext,
  principal: SignedUploadUrlPrincipal<SignedUploadPayload>,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!env.ARTIFACTS) {
    return getBoundResponders(context).respondError("storage_unavailable");
  }
  const payload = principal.payload;

  if (!request.body) {
    return getBoundResponders(context).respondError("invalid_request", "request body is required");
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(contentLength) || contentLength !== payload.size) {
    return getBoundResponders(context).respondError(
      "invalid_content_length",
      "content-length does not match signed upload",
    );
  }

  const encryptionRing = artifactBytesEncryptionRingFromEnv(env);
  if (!encryptionRing) {
    return getBoundResponders(context).respondError("storage_unavailable");
  }
  const keyParts = parseUploadObjectKey(payload);
  if (!keyParts) {
    return getBoundResponders(context).respondError("invalid_request", "upload object key does not match signed path");
  }
  const { blobKeyParts, revisionKeyParts } = keyParts;

  const db = uploadDatabase(env);
  if (!db) {
    return getBoundResponders(context).respondError("storage_unavailable");
  }
  const sessionGuard = await guardWritableSession(context, db, payload);
  if (sessionGuard) {
    return sessionGuard;
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await bytesFromReadableBodyCapped(request.body, payload.size);
  } catch (error) {
    if (error instanceof ReadableBodyTooLargeError) {
      return getBoundResponders(context).respondError("invalid_content_length", "upload body exceeds signed size");
    }
    throw error;
  }
  if (plaintext.byteLength !== payload.size) {
    return getBoundResponders(context).respondError("invalid_content_length", "upload body does not match signed size");
  }
  const observedSha256 = await sha256Hex(plaintext);
  if (payload.sha256 && observedSha256 !== payload.sha256) {
    return getBoundResponders(context).respondError("invalid_request", "upload body does not match signed sha256");
  }
  const encryptionContext =
    payload.sha256 && blobKeyParts
      ? { kind: "blob" as const, workspaceId: payload.wid, sha256: payload.sha256 }
      : {
          workspaceId: payload.wid,
          artifactId: revisionKeyParts?.artifactId ?? "",
          revisionId: revisionKeyParts?.revisionId ?? "",
          normalizedPath: revisionKeyParts?.path ?? "",
        };
  const encrypted = await encryptArtifactBytes({
    plaintext,
    rootSecret: encryptionRing.signingSecret(),
    kid: encryptionRing.signingKid,
    context: encryptionContext,
  });
  // TOCTOU guard: the body read above can stall long enough for finalize to
  // complete, and a write past that point would mutate already-published bytes
  // under an unchanged strong ETag. Re-check session state right before writing.
  const preWriteGuard = await guardWritableSession(context, db, payload);
  if (preWriteGuard) {
    return preWriteGuard;
  }
  const stored = await env.ARTIFACTS.put(payload.key, Uint8Array.from(encrypted.ciphertext), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: encrypted.customMetadata,
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (stored === null) {
    const matches = await existingObjectMatchesUpload(
      env,
      payload.key,
      payload.size,
      encryptionRing,
      encryptionContext,
      observedSha256,
    );
    if (!matches) {
      return getBoundResponders(context).respondError(
        "invalid_request",
        "upload path already contains different bytes",
      );
    }
  }

  await db.recordUploadedFile({
    workspaceId: payload.wid,
    sessionId: payload.sid,
    path: payload.path,
    objectKey: payload.key,
    sizeBytes: payload.size,
    ...(payload.sha256 ? { sha256: payload.sha256 } : {}),
    uploadedAt: new Date().toISOString(),
  });

  return new Response(null, { status: 204, headers: { [REQUEST_ID_HEADER]: getRequestId(context) } });
}

async function existingObjectMatchesUpload(
  env: Env,
  key: string,
  plaintextSize: number,
  encryptionRing: NonNullable<ReturnType<typeof artifactBytesEncryptionRingFromEnv>>,
  encryptionContext: Parameters<typeof decryptArtifactBytesWithKeyRing>[0]["context"],
  observedSha256: string,
): Promise<boolean> {
  const existing = await env.ARTIFACTS?.get(key);
  if (!existing?.body || !isArtifactBytesEncryptionMetadata(existing.customMetadata)) {
    return false;
  }
  try {
    const body =
      existing.body instanceof ReadableStream
        ? existing.body
        : new Blob([
            typeof existing.body === "string"
              ? existing.body
              : existing.body instanceof ArrayBuffer
                ? existing.body
                : Uint8Array.from(existing.body),
          ]).stream();
    const ciphertext = await bytesFromReadableBodyCapped(body, ciphertextByteLengthForPlaintext(plaintextSize));
    const plaintext = await decryptArtifactBytesWithKeyRing({
      ciphertext,
      ring: encryptionRing,
      metadata: existing.customMetadata,
      context: encryptionContext,
    });
    return (await sha256Hex(plaintext)) === observedSha256;
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
