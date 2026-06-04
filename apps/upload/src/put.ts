import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { artifactBytesEncryptionRingFromEnv, resolveUploadTokenSigner } from "@agent-paste/rotation";
import { bytesFromReadableBody, encryptArtifactBytes, parseRevisionFileObjectKey } from "@agent-paste/storage";
import type { SignedUploadPayload } from "@agent-paste/tokens/upload-url";
import { getBoundResponders, type SignedUploadUrlPrincipal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "./env.js";
import { uploadDatabase } from "./upload-db.js";

const UPLOAD_FILE_PATH_MARKER = "/files/";

export function uploadFilePath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const markerIndex = pathname.indexOf(UPLOAD_FILE_PATH_MARKER);
  return markerIndex === -1 ? "" : decodeURIComponent(pathname.slice(markerIndex + UPLOAD_FILE_PATH_MARKER.length));
}

export async function verifyUploadToken(token: string | null, env: Env): Promise<SignedUploadPayload | null> {
  if (!token) {
    return null;
  }
  const signer = resolveUploadTokenSigner(env);
  return signer ? signer.verify(token) : null;
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
    return getBoundResponders(context).respondError("invalid_request", "content-length does not match signed upload");
  }

  const encryptionRing = artifactBytesEncryptionRingFromEnv(env);
  if (!encryptionRing) {
    return getBoundResponders(context).respondError("storage_unavailable");
  }
  const keyParts = parseRevisionFileObjectKey(payload.key);
  if (!keyParts || keyParts.path !== payload.path) {
    return getBoundResponders(context).respondError("invalid_request", "upload object key does not match signed path");
  }
  const plaintext = await bytesFromReadableBody(request.body);
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

  await uploadDatabase(env)?.recordUploadedFile({
    sessionId: payload.sid,
    path: payload.path,
    objectKey: payload.key,
    sizeBytes: payload.size,
    uploadedAt: new Date().toISOString(),
  });

  return new Response(null, { status: 204, headers: { [REQUEST_ID_HEADER]: getRequestId(context) } });
}
