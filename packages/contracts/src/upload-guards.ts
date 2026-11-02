import { LEGACY_SINGLE_PUT_MAX_BYTES, MAX_FILE_BYTES, SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import type * as z from "zod";
import { chunkCount, isUnderPrefix } from "./file-transfer.js";
import type {
  CommitSpec,
  UploadDeletion,
  UploadPrefixDeletion,
  UploadSessionFileInput,
} from "./upload-session-inputs.js";

type Batch = {
  files: UploadSessionFileInput[];
  deletions?: UploadDeletion[] | undefined;
  prefix_deletions?: UploadPrefixDeletion[] | undefined;
};

// Append validates structural rules here; W1 checks the stored session's guard across batches.
export function refineUploadBatch(batch: Batch, ctx: z.RefinementCtx, commit?: CommitSpec, legacy = false): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const paths = new Set<string>();
  for (const [index, file] of batch.files.entries()) {
    if (paths.has(file.path)) issue(["files", index, "path"], "file paths must be unique");
    paths.add(file.path);
    refineFileTransfer(file, index, ctx, legacy);
    refineFileGuard(file, index, batch, ctx, commit, legacy);
  }
  for (const [index, deletion] of (batch.deletions ?? []).entries()) {
    if (paths.has(deletion.path))
      issue(["deletions", index, "path"], "a path cannot be both uploaded and deleted or deleted twice");
    paths.add(deletion.path);
    if (commit?.guard === "paths" && !deletion.expect)
      issue(["deletions", index, "expect"], "paths guard requires expect");
    if (commit?.guard === "snapshot") {
      if (deletion.expect) issue(["deletions", index, "expect"], "snapshot guard excludes expect");
      if (commit.snapshot && !isUnderPrefix(deletion.path, commit.snapshot.prefix))
        issue(["deletions", index, "path"], "deletion must be under snapshot prefix");
    }
  }
  const prefixes = batch.prefix_deletions?.map((deletion) => deletion.prefix) ?? [];
  if (new Set(prefixes).size !== prefixes.length) issue(["prefix_deletions"], "prefixes must be unique");
  if (commit?.guard === "snapshot" && batch.prefix_deletions !== undefined)
    issue(["prefix_deletions"], "prefix_deletions requires paths guard");
}

function refineFileTransfer(file: UploadSessionFileInput, index: number, ctx: z.RefinementCtx, legacy: boolean): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (file.patch && file.sha256)
    issue(["files", index, "sha256"], "a patched file cannot also declare a whole-file sha256");
  if (file.chunks) {
    if (legacy) issue(["files", index, "chunks"], "chunks requires commit");
    if (file.patch) issue(["files", index, "chunks"], "chunks excludes patch");
    if (!file.sha256) issue(["files", index, "sha256"], "chunks requires sha256");
    if (file.size_bytes <= SINGLE_PUT_MAX_BYTES) issue(["files", index, "chunks"], "small files use single PUT");
    if (file.size_bytes <= MAX_FILE_BYTES && file.chunks.sha256.length !== chunkCount(file.size_bytes))
      issue(["files", index, "chunks"], "chunk count must match file size");
  } else if (!legacy && file.size_bytes > SINGLE_PUT_MAX_BYTES) {
    ctx.addIssue({
      code: "custom",
      path: ["files", index, "size_bytes"],
      message: "files over 10 MiB require chunked upload",
      params: { code: "file_size_cap_exceeded" },
    });
  }
  if (legacy && file.size_bytes > LEGACY_SINGLE_PUT_MAX_BYTES)
    issue(["files", index, "size_bytes"], "legacy single PUTs cannot exceed 25 MiB");
}

function refineFileGuard(
  file: UploadSessionFileInput,
  index: number,
  batch: Batch,
  ctx: z.RefinementCtx,
  commit: CommitSpec | undefined,
  legacy: boolean,
): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if ((legacy || commit?.guard === "snapshot") && file.expect)
    issue(["files", index, "expect"], "expect requires paths guard");
  if (commit?.guard === "paths" && !file.expect) issue(["files", index, "expect"], "paths guard requires expect");
  if (commit?.guard === "snapshot" && commit.snapshot && !isUnderPrefix(file.path, commit.snapshot.prefix))
    issue(["files", index, "path"], "file must be under snapshot prefix");
  if (batch.prefix_deletions?.some((deletion) => isUnderPrefix(file.path, deletion.prefix)))
    issue(["files", index, "path"], "file cannot be under a deleted prefix");
}

export function refineLegacyCreate(
  request: Batch & {
    base_revision_id?: string | undefined;
    deleted_paths?: string[] | undefined;
    more_files?: boolean | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });

  if (request.deletions !== undefined || request.prefix_deletions !== undefined || request.more_files !== undefined)
    issue(["commit"], "batched files and deletions require commit");
  if (!request.base_revision_id) {
    if (request.files.length === 0) issue(["files"], "files must contain at least one entry without base_revision_id");
    if (request.deleted_paths !== undefined) issue(["deleted_paths"], "deleted_paths requires base_revision_id");
    if (request.files.some((file) => file.patch)) issue(["files"], "patch requires base_revision_id");
  } else if (request.files.length === 0 && !request.deleted_paths?.length)
    issue(["files"], "a base_revision_id delta needs at least one changed file or deleted path");
  const deleted = new Set(request.deleted_paths ?? []);
  if (deleted.size !== (request.deleted_paths?.length ?? 0)) issue(["deleted_paths"], "deleted_paths must be unique");
  if (request.files.some((file) => deleted.has(file.path)))
    issue(["files"], "a path cannot be both uploaded and deleted");
}
