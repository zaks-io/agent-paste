import { ciphertextByteLengthForPlaintext, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import type { ObservedUploadFile } from "./repository/upload-session-lifecycle.js";
import type { toUploadSessionRecord } from "./transforms.js";
import { objectKeyFor } from "./validation.js";

export type UploadSessionRecord = ReturnType<typeof toUploadSessionRecord>;

export type UploadSessionFileDescriptor = UploadSessionRecord["files"][number] & { chunk_index?: number };

export type ObjectStoragePort = {
  head(key: string): Promise<{ size: number } | null>;
};

export type SignedPutUrl = { url: string; expiresAt: string };

export type UploadSigningPort = {
  signPutUrl(session: UploadSessionRecord, file: UploadSessionFileDescriptor): Promise<SignedPutUrl>;
};

const MAX_CONCURRENT_STORAGE_CHECKS = 6;

export function resolveSessionObjectKey(session: UploadSessionRecord, path: string, explicitKey?: string): string {
  return explicitKey ?? objectKeyFor(session.artifact_id, session.revision_id, path);
}

export async function buildCreateUploadSessionWireResponse(session: UploadSessionRecord, signing: UploadSigningPort) {
  const files: Array<
    | { status: "reused" | "verify_required"; path: string }
    | {
        status: "upload_required" | "chunk_upload_required";
        path: string;
        put_url: string;
        required_headers: { "content-length": string };
        expires_at: string;
        chunk_index?: number;
      }
  > = [];
  const seen = new Set<string>();
  filesLoop: for (const file of session.files) {
    if (files.length >= 2000) break;
    if (file.content_format === "chunked-v1") {
      if (file.verified_at) {
        files.push({ status: "reused", path: file.path });
        continue;
      }
      const missing = (session.chunks ?? []).filter((c) => c.path === file.path && !c.uploaded_at);
      if (!missing.length) files.push({ status: "verify_required", path: file.path });
      for (const c of missing) {
        if (files.length >= 2000) break filesLoop;
        const signed = await signing.signPutUrl(session, {
          ...file,
          object_key: workspaceBlobObjectKeyFor({ workspaceId: session.workspace_id, sha256: c.sha256 }),
          size_bytes: c.size_bytes,
          sha256: c.sha256,
          chunk_index: c.chunk_index,
        });
        files.push({
          status: "chunk_upload_required",
          path: file.path,
          chunk_index: c.chunk_index,
          put_url: signed.url,
          required_headers: { "content-length": String(c.size_bytes) },
          expires_at: signed.expiresAt,
        });
      }
    } else {
      const key = resolveSessionObjectKey(session, file.path, file.object_key);
      if (file.uploaded_at || seen.has(key)) {
        files.push({ status: "reused", path: file.path });
        continue;
      }
      seen.add(key);
      const signed = await signing.signPutUrl(session, file);
      files.push({
        status: "upload_required",
        path: file.path,
        put_url: signed.url,
        required_headers: { "content-length": String(file.size_bytes) },
        expires_at: signed.expiresAt,
      });
    }
  }
  return {
    upload_session_id: session.session_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    status: "pending" as const,
    expires_at: session.expires_at,
    files: files.slice(0, 2000),
    ...(session.commit_guard
      ? { sealed: session.sealed ?? false, next_batch_index: session.next_batch_index ?? 1 }
      : {}),
  };
}

export async function observeUploadSessionForFinalize(
  session: UploadSessionRecord,
  storage: ObjectStoragePort,
): Promise<{ observedFiles: ObservedUploadFile[] } | { incompletePath: string }> {
  if (session.commit_guard) return { observedFiles: [] };
  const observedFiles: ObservedUploadFile[] = [];
  for (let offset = 0; offset < session.files.length; offset += MAX_CONCURRENT_STORAGE_CHECKS) {
    const files = session.files.slice(offset, offset + MAX_CONCURRENT_STORAGE_CHECKS);
    const observations = await Promise.all(
      files.map(async (file) => {
        const objectKey = resolveSessionObjectKey(session, file.path, file.object_key);
        return { file, objectKey, object: await storage.head(objectKey) };
      }),
    );

    for (const { file, objectKey, object } of observations) {
      const expectedSize = ciphertextByteLengthForPlaintext(file.size_bytes);
      if (!object || object.size !== expectedSize) {
        return { incompletePath: file.path };
      }
      observedFiles.push({ path: file.path, objectKey, sizeBytes: file.size_bytes });
    }
  }
  return { observedFiles };
}
