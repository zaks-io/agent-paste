import { ciphertextByteLengthForPlaintext } from "@agent-paste/storage";
import type { ObservedUploadFile } from "./repository/upload-session-lifecycle.js";
import type { toUploadSessionRecord } from "./transforms.js";
import { objectKeyFor } from "./validation.js";

export type UploadSessionRecord = ReturnType<typeof toUploadSessionRecord>;

export type UploadSessionFileDescriptor = UploadSessionRecord["files"][number];

export type ObjectStoragePort = {
  head(key: string): Promise<{ size: number } | null>;
};

export type SignedPutUrl = { url: string; expiresAt: string };

export type UploadSigningPort = {
  signPutUrl(session: UploadSessionRecord, file: UploadSessionFileDescriptor): Promise<SignedPutUrl>;
};

export function resolveSessionObjectKey(session: UploadSessionRecord, path: string, explicitKey?: string): string {
  return explicitKey ?? objectKeyFor(session.artifact_id, session.revision_id, path);
}

export async function buildCreateUploadSessionWireResponse(
  session: UploadSessionRecord,
  signing: UploadSigningPort,
): Promise<{
  upload_session_id: string;
  artifact_id: string;
  revision_id: string;
  status: "pending";
  expires_at: string;
  files: Array<
    | {
        status: "upload_required";
        path: string;
        put_url: string;
        required_headers: { "content-length": string };
        expires_at: string;
      }
    | {
        status: "reused";
        path: string;
      }
  >;
}> {
  const signedByObjectKey = new Set<string>();
  const files = [];
  for (const file of session.files as UploadSessionFileDescriptor[]) {
    const objectKey = resolveSessionObjectKey(session, file.path, file.object_key);
    const alreadySatisfied = file.uploaded_at !== null && file.uploaded_at !== undefined;
    const shouldUpload = !alreadySatisfied && !signedByObjectKey.has(objectKey);
    if (!shouldUpload) {
      files.push({ status: "reused" as const, path: file.path });
      continue;
    }
    signedByObjectKey.add(objectKey);
    const signed = await signing.signPutUrl(session, file);
    files.push({
      status: "upload_required" as const,
      path: file.path,
      put_url: signed.url,
      required_headers: { "content-length": String(file.size_bytes) },
      expires_at: signed.expiresAt,
    });
  }

  return {
    upload_session_id: session.session_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    status: "pending",
    expires_at: session.expires_at,
    files,
  };
}

export async function observeUploadSessionForFinalize(
  session: UploadSessionRecord,
  storage: ObjectStoragePort,
): Promise<{ observedFiles: ObservedUploadFile[] } | { incompletePath: string }> {
  const observedFiles: ObservedUploadFile[] = [];
  for (const file of session.files) {
    const objectKey = resolveSessionObjectKey(session, file.path, file.object_key);
    const object = await storage.head(objectKey);
    const expectedSize = ciphertextByteLengthForPlaintext(file.size_bytes);
    if (!object || object.size !== expectedSize) {
      return { incompletePath: file.path };
    }
    observedFiles.push({ path: file.path, objectKey, sizeBytes: file.size_bytes });
  }
  return { observedFiles };
}
