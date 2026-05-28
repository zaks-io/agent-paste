import { ciphertextByteLengthForPlaintext } from "@agent-paste/storage";
import type { ObservedUploadFile } from "./repository/upload-session-lifecycle.js";
import type { toUploadSessionRecord } from "./transforms.js";
import { objectKeyFor } from "./validation.js";

export type UploadSessionRecord = ReturnType<typeof toUploadSessionRecord>;

export type UploadSessionFileDescriptor = UploadSessionRecord["files"][number] & {
  put_url?: string;
};

export type ObjectStoragePort = {
  head(key: string): Promise<{ size: number } | null>;
};

export type UploadSigningPort = {
  signPutUrl(session: UploadSessionRecord, file: UploadSessionFileDescriptor): Promise<string>;
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
  files: Array<{
    path: string;
    put_url: string;
    required_headers: { "content-length": string };
    expires_at: string;
  }>;
}> {
  const signedFiles = await Promise.all(
    session.files.map(async (file: UploadSessionFileDescriptor) => ({
      path: file.path,
      put_url: file.put_url ?? (await signing.signPutUrl(session, file)),
      required_headers: { "content-length": String(file.size_bytes) },
      expires_at: file.expires_at ?? session.expires_at,
    })),
  );

  return {
    upload_session_id: session.session_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    status: "pending",
    expires_at: session.expires_at,
    files: signedFiles,
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
