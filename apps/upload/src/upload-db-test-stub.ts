import type { Env } from "./env.js";

type RecordUploadedFileInput = {
  sessionId: string;
  path: string;
  objectKey?: string;
  sizeBytes?: number;
  uploadedAt: string;
};

export type UploadDbStubOptions = {
  status?: string;
  expiresAt?: string;
  missing?: boolean;
  onRecord?: (input: RecordUploadedFileInput) => void;
};

/**
 * Minimal in-memory `Repository` shape the upload worker recognizes via
 * `isUploadDatabase` (it checks for `createUploadSession`). Only the methods the
 * PUT path touches are implemented.
 */
export function uploadDbStub(options: UploadDbStubOptions = {}): NonNullable<Env["DB"]> {
  const status = options.status ?? "pending";
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString();
  return {
    createUploadSession() {
      throw new Error("createUploadSession not implemented in stub");
    },
    async getUploadSessionState(_input: { workspaceId: string; sessionId: string }) {
      return options.missing ? null : { status, expiresAt };
    },
    async recordUploadedFile(input: RecordUploadedFileInput) {
      options.onRecord?.(input);
      return undefined;
    },
  } as unknown as NonNullable<Env["DB"]>;
}
