import type { Env } from "./env.js";

type RecordUploadedFileInput = {
  workspaceId?: string;
  sessionId: string;
  path: string;
  objectKey?: string;
  sizeBytes?: number;
  sha256?: string;
  uploadedAt: string;
};

export type UploadDbStubOptions = {
  status?: string;
  /** Statuses returned by successive `getUploadSessionState` reads; the last one repeats. */
  statusSequence?: string[];
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
  const statusSequence = options.statusSequence ?? [options.status ?? "pending"];
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString();
  let reads = 0;
  return {
    createUploadSession() {
      throw new Error("createUploadSession not implemented in stub");
    },
    async getUploadSessionState(_input: { workspaceId: string; sessionId: string }) {
      if (options.missing) {
        return null;
      }
      const status = statusSequence[Math.min(reads, statusSequence.length - 1)];
      reads += 1;
      return { status, expiresAt };
    },
    async recordUploadedFile(input: RecordUploadedFileInput) {
      options.onRecord?.(input);
      return undefined;
    },
  } as unknown as NonNullable<Env["DB"]>;
}
