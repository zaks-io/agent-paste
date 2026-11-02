import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ApiClient, type PullStore, pullFiles, pullPlan } from "@agent-paste/api-client";
import { ArtifactReference } from "@agent-paste/contracts/primitives";
import { type Root, root } from "@openclaw/fs-safe/root";
import { booleanFlag, output, type Parsed, requiredArg, stringFlag } from "./cli-args.js";
import { MAX_FILE_BYTES } from "./local.js";
import { pullCache, pullCacheKey } from "./pull-cache.js";
export async function pullDirectory(parsed: Parsed, client: ApiClient): Promise<void> {
  const artifactId = ArtifactReference.parse(requiredArg(parsed, 0, "artifact-id"));
  const directory = path.resolve(stringFlag(parsed, "output")!);
  const dryRun = booleanFlag(parsed, "dry-run", false);
  // A dry run can inspect an existing directory, but must not create one.
  const exists = await fs.stat(directory).then(
    () => true,
    (error: unknown) => {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw error;
    },
  );
  if (!exists && !dryRun) await fs.mkdir(directory, { recursive: true });
  const store =
    exists || !dryRun
      ? diskPullStore(await root(directory, { maxBytes: MAX_FILE_BYTES, symlinks: "reject", hardlinks: "reject" }))
      : emptyPullStore();
  const revisionId = stringFlag(parsed, "revision-id");
  const input = {
    artifactId,
    paths: parsed.positionals.slice(1),
    overwrite: booleanFlag(parsed, "overwrite", false),
    dryRun,
    ...(revisionId ? { revisionId } : {}),
  };
  const transport = {
    listFiles: client.artifactFiles.list,
    readGrant: client.artifacts.readGrant,
    fetchContent: (url: string, headers: Record<string, string>) => client.fetchContent(url, headers),
  };
  const plan = await pullPlan(transport, store, input);
  if (dryRun)
    return output(
      { revision_id: plan.grant.revision_id, files: plan.files, skipped: plan.skipped, conflicts: plan.conflicts },
      parsed.global,
    );
  return output(await pullFiles(transport, store, plan, input), parsed.global);
}
export function diskPullStore(safe: Root): PullStore {
  let cachePromise: Promise<Root> | undefined;
  const cache = () => (cachePromise ??= pullCache(safe));
  const partialName = (p: string) => `${pullCacheKey(p)}.data`;
  const metaName = (p: string) => `${pullCacheKey(p)}.json`;
  async function metadata(p: string) {
    const state = await cache();
    if (!(await state.exists(metaName(p)))) {
      if (await state.exists(partialName(p))) throw new Error("unowned_pull_cache_file");
      return null;
    }
    const meta = await state.readJson<{
      path: string;
      etag: string;
      revisionId: string;
      sha256: string;
      dev: number;
      ino: number;
    }>(metaName(p), { maxBytes: 4096 });
    if (
      meta.path !== p ||
      typeof meta.etag !== "string" ||
      typeof meta.revisionId !== "string" ||
      typeof meta.sha256 !== "string"
    )
      throw new Error("invalid_pull_cache_metadata");
    if (await state.exists(partialName(p))) {
      const stat = await state.stat(partialName(p));
      if (stat.dev !== meta.dev || stat.ino !== meta.ino) throw new Error("unowned_pull_cache_file");
    }
    return meta;
  }
  async function remove(p: string) {
    if (!(await metadata(p))) return;
    const state = await cache();
    for (const name of [partialName(p), metaName(p)]) {
      try {
        await state.remove(name);
      } catch (error) {
        if ((error as { code?: string }).code !== "not-found") throw error;
      }
    }
  }
  return {
    inspect: (p) => inspectFile(safe, p),
    partial: async (p) => {
      const meta = await metadata(p);
      const state = await cache();
      if (!meta || !(await state.exists(partialName(p)))) return null;
      return { ...meta, sizeBytes: (await state.stat(partialName(p))).size };
    },
    begin: async (p, meta, resume) => {
      const state = await cache();
      if (!resume) {
        await remove(p);
        const created = await state.openWritable(partialName(p), { writeMode: "update", mode: 0o600 });
        try {
          if (!created.createdForWrite) throw new Error("unowned_pull_cache_file");
          await state.createJson(
            metaName(p),
            { ...meta, path: p, dev: created.stat.dev, ino: created.stat.ino },
            { mode: 0o600 },
          );
        } finally {
          await created.handle.close();
        }
      } else if (!(await metadata(p))) throw new Error("missing_pull_cache_metadata");
      const owner = await metadata(p);
      const opened = await state.openWritable(partialName(p), { writeMode: "append", mode: 0o600 });
      if (!owner || opened.stat.dev !== owner.dev || opened.stat.ino !== owner.ino) {
        await opened.handle.close();
        throw new Error("unowned_pull_cache_file");
      }
      return {
        write: async (bytes) => {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await opened.handle.write(bytes, offset, bytes.length - offset);
            if (!bytesWritten) throw new Error("short_local_write");
            offset += bytesWritten;
          }
        },
        close: async () => {
          try {
            await opened.handle.sync();
          } finally {
            await opened.handle.close();
          }
        },
      };
    },
    verifyPartial: async (p) => {
      const result = await inspectFile(await cache(), partialName(p));
      if (!result) throw new Error("missing_partial_file");
      return result;
    },
    commit: async (p, overwrite) => {
      const state = await cache();
      if (!(await metadata(p))) throw new Error("missing_pull_cache_metadata");
      const source = await state.open(partialName(p));
      try {
        await installFile(safe, source, p, overwrite);
      } finally {
        await source.handle.close();
      }
      await remove(p);
    },
    removePartial: remove,
  };
}
async function inspectFile(source: Root, p: string) {
  let opened: Awaited<ReturnType<Root["open"]>>;
  try {
    opened = await source.open(p);
  } catch (error) {
    if ((error as { code?: string }).code === "not-found") return null;
    throw error;
  }
  try {
    const hash = createHash("sha256");
    const bytes = new Uint8Array(4 * 1024 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await opened.handle.read(bytes, 0, bytes.length, offset);
      if (!bytesRead) break;
      hash.update(bytes.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return { sha256: hash.digest("hex"), sizeBytes: offset };
  } finally {
    await opened.handle.close();
  }
}
async function installFile(safe: Root, source: Awaited<ReturnType<Root["open"]>>, p: string, overwrite: boolean) {
  if (overwrite) {
    await safe.copyIn(p, source.realPath, { maxBytes: MAX_FILE_BYTES, sourceHardlinks: "reject" });
  } else {
    // update never truncates an existing file. createdForWrite proves that
    // fs-safe used O_EXCL; all writes then target that pinned descriptor.
    const target = await safe.openWritable(p, { writeMode: "update", mode: 0o600 });
    try {
      if (!target.createdForWrite)
        throw Object.assign(new Error(`Local file appeared: ${p}`), { code: "local_conflict" });
      const bytes = new Uint8Array(4 * 1024 * 1024);
      let position = 0;
      while (true) {
        const { bytesRead } = await source.handle.read(bytes, 0, bytes.length, position);
        if (!bytesRead) break;
        let offset = 0;
        while (offset < bytesRead) {
          const { bytesWritten } = await target.handle.write(bytes, offset, bytesRead - offset);
          if (!bytesWritten) throw new Error("short_local_write");
          offset += bytesWritten;
        }
        position += bytesRead;
      }
      await target.handle.sync();
      const current = await safe.open(p);
      try {
        if (current.stat.dev !== target.stat.dev || current.stat.ino !== target.stat.ino)
          throw Object.assign(new Error(`Local file changed during installation: ${p}`), { code: "local_conflict" });
      } finally {
        await current.handle.close();
      }
    } finally {
      await target.handle.close();
    }
  }
}
function emptyPullStore(): PullStore {
  const fail = async (): Promise<never> => {
    throw new Error("dry_run_write");
  };
  return {
    inspect: async () => null,
    partial: async () => null,
    begin: fail,
    verifyPartial: fail,
    commit: fail,
    removePartial: fail,
  };
}
