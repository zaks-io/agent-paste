import type { ArtifactFileListItem } from "@agent-paste/contracts/artifact-files";
import { isUnderPrefix } from "@agent-paste/contracts/file-transfer";
import { FilePath } from "@agent-paste/contracts/primitives";
import type { RevisionReadGrant } from "@agent-paste/contracts/read-grants";
import { listRevisionFiles } from "./publish-plan.js";
import type { PublishTransport } from "./publish-types.js";
import { transferRetry } from "./transfer-retry.js";
export type PullTransport = Pick<PublishTransport, "listFiles"> & {
  readGrant(artifactId: string, revisionId?: string): Promise<RevisionReadGrant>;
  fetchContent(url: string, headers: Record<string, string>): Promise<Response>;
};
export type PullStore = {
  inspect(path: string): Promise<{ sha256: string; sizeBytes: number } | null>;
  partial(path: string): Promise<{ sizeBytes: number; etag: string; revisionId: string; sha256: string | null } | null>;
  begin(
    path: string,
    meta: { etag: string; revisionId: string; sha256: string | null },
    resume: boolean,
  ): Promise<{ write(bytes: Uint8Array): Promise<void>; close(): Promise<void> }>;
  verifyPartial(path: string): Promise<{ sha256: string; sizeBytes: number }>;
  commit(path: string, overwrite: boolean): Promise<void>;
  removePartial(path: string): Promise<void>;
};
export type PullInput = {
  artifactId: string;
  revisionId?: string;
  paths?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
};
export type PullPlan = {
  grant: RevisionReadGrant;
  files: ArtifactFileListItem[];
  skipped: number;
  conflicts: string[];
};
export async function pullPlan(t: PullTransport, store: PullStore, input: PullInput): Promise<PullPlan> {
  const selections = (input.paths ?? []).map((path) => FilePath.parse(path));
  const grant = await transferRetry(() => t.readGrant(input.artifactId, input.revisionId));
  if (input.revisionId && grant.revision_id !== input.revisionId) throw new Error("revision_changed_in_read_grant");
  const listing = await listRevisionFiles(t, grant.artifact_id, grant.revision_id);
  if (listing.page.file_count !== grant.file_count || listing.page.size_bytes !== grant.size_bytes)
    throw new Error("read_grant_listing_mismatch");
  for (const path of selections)
    if (!listing.files.some((f) => f.path === path || isUnderPrefix(f.path, path)))
      throw new Error(`remote_path_not_found: ${path}`);
  const selected = listing.files.filter(
    (f) => !selections.length || selections.some((p) => f.path === p || isUnderPrefix(f.path, p)),
  );
  // A remote file cannot also be an ancestor of another selected file.
  const names = new Set<string>(selected.map((f) => f.path));
  for (const file of selected) {
    const parts = file.path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const ancestor = parts.slice(0, n).join("/");
      if (n < parts.length && names.has(ancestor)) throw new Error("remote_path_collision");
    }
  }
  const files: ArtifactFileListItem[] = [];
  const conflicts: string[] = [];
  let skipped = 0;
  for (const file of selected) {
    const local = await store.inspect(file.path);
    if (local && file.sha256 && local.sha256 === file.sha256 && local.sizeBytes === file.size_bytes) {
      skipped++;
      continue;
    }
    if (local && !input.overwrite) conflicts.push(file.path);
    files.push(file);
  }
  return { grant, files, skipped, conflicts };
}
