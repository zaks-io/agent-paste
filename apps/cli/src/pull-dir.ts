import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ApiClient, type PullStore, pullFiles, pullPlan } from "@agent-paste/api-client";
import { ArtifactReference } from "@agent-paste/contracts/primitives";
import { type Root, root } from "@openclaw/fs-safe/root";
import { booleanFlag, output, type Parsed, requiredArg, stringFlag } from "./cli-args.js";
import { MAX_FILE_BYTES } from "./local.js";
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
  const partialName = (p: string) => `${p}.agent-paste-partial`;
  const metaName = (p: string) => `${partialName(p)}.json`;
  async function inspect(p: string) {
    let opened: Awaited<ReturnType<Root["open"]>>;
    try {
      opened = await safe.open(p);
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
  async function remove(p: string) {
    for (const name of [partialName(p), metaName(p)]) {
      try {
        await safe.remove(name);
      } catch (error) {
        if ((error as { code?: string }).code !== "not-found") throw error;
      }
    }
  }
  return {
    inspect,
    partial: async (p) => {
      if (!(await safe.exists(partialName(p)))) return null;
      if (!(await safe.exists(metaName(p)))) {
        await remove(p);
        return null;
      }
      const meta = await safe.readJson<{ etag: string; revisionId: string; sha256: string | null }>(metaName(p), {
        maxBytes: 4096,
      });
      if (typeof meta.etag !== "string" || typeof meta.revisionId !== "string" || typeof meta.sha256 !== "string") {
        await remove(p);
        return null;
      }
      return { ...meta, sizeBytes: (await safe.stat(partialName(p))).size };
    },
    begin: async (p, meta, resume) => {
      const opened = await safe.openWritable(partialName(p), { writeMode: resume ? "append" : "replace", mode: 0o600 });
      try {
        await safe.writeJson(metaName(p), meta, { mode: 0o600 });
      } catch (error) {
        await opened.handle.close();
        throw error;
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
      const result = await inspect(partialName(p));
      if (!result) throw new Error("missing_partial_file");
      return result;
    },
    commit: async (p, overwrite) => {
      await safe.move(partialName(p), p, { overwrite });
      await safe.remove(metaName(p));
    },
    removePartial: remove,
  };
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
