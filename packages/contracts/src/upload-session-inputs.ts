import { CHUNK_BYTES, MAX_CHUNKS_PER_FILE, MAX_FILE_BYTES } from "@agent-paste/config";
import * as z from "zod";
import { FilePath, Sha256Hex } from "./primitives.js";

// Patch bytes describe the diff; result_sha256 describes the reconstructed plaintext.
export const UploadSessionFilePatch = z.object({
  base_sha256: Sha256Hex,
  format: z.literal("unified"),
  result_sha256: Sha256Hex,
});
export type UploadSessionFilePatch = z.infer<typeof UploadSessionFilePatch>;
export const PathExpectation = z.union([
  z.object({ sha256: Sha256Hex, size_bytes: z.number().int().nonnegative() }).strict(),
  z.object({ absent: z.literal(true) }).strict(),
]);
export type PathExpectation = z.infer<typeof PathExpectation>;
export const UploadSessionChunks = z
  .object({ chunk_bytes: z.literal(CHUNK_BYTES), sha256: z.array(Sha256Hex).min(1).max(MAX_CHUNKS_PER_FILE) })
  .strict();
export type UploadSessionChunks = z.infer<typeof UploadSessionChunks>;
export const UploadSessionFileInput = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative().max(MAX_FILE_BYTES),
  sha256: Sha256Hex.optional(),
  patch: UploadSessionFilePatch.optional(),
  chunks: UploadSessionChunks.optional(),
  expect: PathExpectation.optional(),
});
export type UploadSessionFileInput = z.infer<typeof UploadSessionFileInput>;
export const UploadDeletion = z
  .object({
    path: FilePath,
    expect: z.object({ sha256: Sha256Hex, size_bytes: z.number().int().nonnegative() }).strict().optional(),
  })
  .strict();
export type UploadDeletion = z.infer<typeof UploadDeletion>;
export const UploadPrefixDeletion = z.object({ prefix: FilePath, snapshot_sha256: Sha256Hex }).strict();
export type UploadPrefixDeletion = z.infer<typeof UploadPrefixDeletion>;
export const CommitSpec = z
  .object({
    guard: z.enum(["paths", "snapshot"]),
    snapshot: z.object({ prefix: FilePath.nullable(), sha256: Sha256Hex }).strict().optional(),
    pin: z.boolean().optional(),
  })
  .strict()
  .superRefine((commit, ctx) => {
    if ((commit.guard === "snapshot") !== (commit.snapshot !== undefined))
      ctx.addIssue({ code: "custom", path: ["snapshot"], message: "snapshot is required only for snapshot guard" });
  });
export type CommitSpec = z.infer<typeof CommitSpec>;
