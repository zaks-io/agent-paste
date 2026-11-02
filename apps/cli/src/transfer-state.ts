import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ApiClient,
  LocalSource,
  PublishPlan,
  PublishPlanInput,
  PublishTransferState,
} from "@agent-paste/api-client";
import { root } from "@openclaw/fs-safe/root";
import { type Parsed, repeatedFlag } from "./cli-args.js";
import { configDir } from "./credentials.js";
export type SavedPublish = {
  key: string;
  title: PublishPlanInput["title"];
  entrypoint: string;
  sources: Omit<LocalSource, "readRange">[];
  plan: Omit<PublishPlan, "upserts"> & { upserts: Omit<LocalSource, "readRange">[] };
  state?: PublishTransferState;
};
export async function publishStateFor(parsed: Parsed, client: ApiClient, input: PublishPlanInput) {
  const who = await client.whoami();
  return publishState({
    server: client.apiBaseUrl,
    uploadServer: client.uploadBaseUrl,
    actor: who.actor.id,
    workspace: who.workspace.id,
    inputPath: parsed.positionals[0] ? path.resolve(parsed.positionals[0]) : null,
    artifactId: input.artifactId,
    explicitFlags: Object.fromEntries(
      ["title", "entrypoint", "to", "exclude", "delete"].map((name) => [name, repeatedFlag(parsed, name)]),
    ),
    mode: input.mode,
    pin: input.pin,
    deletions: input.deletePaths,
  });
}
export async function publishState(identity: unknown) {
  const directory = path.join(configDir(), "transfers");
  const filename = `${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.json`;
  const safe = async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return root(directory, { symlinks: "reject", hardlinks: "reject", maxBytes: 16 * 1024 * 1024 });
  };
  return {
    load: async (): Promise<SavedPublish | null> => {
      try {
        return await (await safe()).readJson<SavedPublish>(filename);
      } catch (error) {
        if ((error as { code?: string }).code === "not-found") return null;
        throw error;
      }
    },
    save: async (saved: SavedPublish) => {
      await (await safe()).writeJson(filename, saved, { mode: 0o600 });
    },
    remove: async () => {
      try {
        await (await safe()).remove(filename);
      } catch (error) {
        if ((error as { code?: string }).code !== "not-found") throw error;
      }
    },
  };
}
export function serializePlan(plan: PublishPlan): SavedPublish["plan"] {
  return { ...plan, upserts: plan.upserts.map(({ readRange: _readRange, ...source }) => source) };
}
export function restorePlan(saved: SavedPublish, sources: LocalSource[]): PublishPlan {
  const manifest = (files: Omit<LocalSource, "readRange">[]) =>
    JSON.stringify(
      files
        .map(({ path, sha256, sizeBytes, contentType, chunkSha256 }) => ({
          path,
          sha256,
          sizeBytes,
          contentType,
          chunkSha256,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    );
  if (!saved.sources || manifest(saved.sources) !== manifest(sources))
    throw Object.assign(
      new Error("local_file_changed: saved selection differs; use --restart to discard the saved plan"),
      { code: "local_file_changed" },
    );
  const plan = saved.plan;
  return {
    ...plan,
    upserts: plan.upserts.map((entry) => {
      const source = sources.find(
        (f) => f.path === entry.path && f.sha256 === entry.sha256 && f.sizeBytes === entry.sizeBytes,
      );
      if (!source) throw Object.assign(new Error(`local_file_changed: ${entry.path}`), { code: "local_file_changed" });
      return { ...source, ...entry };
    }),
  };
}
