import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import type { Repository } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv, resolveUploadTokenSigner } from "@agent-paste/rotation";
import {
  bytesFromReadableBodyCapped,
  encryptArtifactBytes,
  parseRevisionFileObjectKey,
  ReadableBodyTooLargeError,
} from "@agent-paste/storage";
import type { SignedUploadPayload } from "@agent-paste/tokens/upload-url";
import { getBoundResponders, type SignedUploadUrlPrincipal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "./env.js";
import { uploadDatabase } from "./upload-db.js";

const UPLOAD_FILE_PATH_MARKER = "/files/";

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
  const keyParts = parseRevisionFileObjectKey(payload.key);
  if (!keyParts || keyParts.path !== payload.path) {
    return getBoundResponders(context).respondError("invalid_request", "upload object key does not match signed path");
  }

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
  const encrypted = await encryptArtifactBytes({
    plaintext,
    rootSecret: encryptionRing.signingSecret(),
    kid: encryptionRing.signingKid,
    context: {
      workspaceId: payload.wid,
      artifactId: keyParts.artifactId,
      revisionId: keyParts.revisionId,
      normalizedPath: keyParts.path,
    },
  });
  await env.ARTIFACTS.put(payload.key, Uint8Array.from(encrypted.ciphertext), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: encrypted.customMetadata,
  });

  await db.recordUploadedFile({
    sessionId: payload.sid,
    path: payload.path,
    objectKey: payload.key,
    sizeBytes: payload.size,
    uploadedAt: new Date().toISOString(),
  });

  return new Response(null, { status: 204, headers: { [REQUEST_ID_HEADER]: getRequestId(context) } });
}
