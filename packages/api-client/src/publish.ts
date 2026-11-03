import { executePublish } from "./publish-commit.js";
import { type PublishMode, planPublish } from "./publish-plan.js";
import type { LocalSource, PublishInput, PublishOutcome, PublishTransport } from "./publish-types.js";

export type * from "./publish-types.js";
export async function runPublish(t: PublishTransport, input: PublishInput): Promise<PublishOutcome> {
  const sources: LocalSource[] = input.files.map(({ read, ...file }) => ({
    ...file,
    readRange: async (start, length) => (await read()).slice(start, start + length),
  }));
  const planInput = {
    sources,
    title: input.title,
    entrypoint: input.entrypoint,
    idempotencyKey: input.idempotencyKey,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.pin !== undefined ? { pin: input.pin } : {}),
    ...(input.deletedPaths ? { deletePaths: input.deletedPaths } : {}),
    mode: { kind: input.commit?.guard === "paths" || input.baseRevisionId ? "paths" : "tree" } as PublishMode,
    ...(input.onUploadProgress ? { onProgress: input.onUploadProgress } : {}),
  };
  if (input.commit) {
    return executePublish(
      t,
      {
        commit: input.commit,
        upserts: sources,
        deletions: [],
        prefixDeletions: [],
        unchanged: 0,
        headRevisionId: input.baseRevisionId ?? null,
        bytesToSendMax: sources.reduce((n, f) => n + f.sizeBytes, 0),
        noChange: false,
        changes: { added: 0, changed: sources.length, removed: 0 },
      },
      planInput,
    );
  }
  return executePublish(t, await planPublish(t, planInput), planInput);
}
export * from "./publish-commit.js";
export * from "./publish-plan.js";
export * from "./pull-plan.js";
export * from "./pull-transfer.js";
