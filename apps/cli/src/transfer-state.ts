import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalSource, PublishPlan, PublishTransferState } from "@agent-paste/api-client";
import { root } from "@openclaw/fs-safe/root";
import { configDir } from "./credentials.js";
export type SavedPublish = {
  key: string;
  plan: Omit<PublishPlan, "upserts"> & { upserts: Omit<LocalSource, "readRange">[] };
  state?: PublishTransferState;
};
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
export function restorePlan(saved: SavedPublish["plan"], sources: LocalSource[]): PublishPlan {
  return {
    ...saved,
    upserts: saved.upserts.map((entry) => {
      const source = sources.find(
        (f) => f.path === entry.path && f.sha256 === entry.sha256 && f.sizeBytes === entry.sizeBytes,
      );
      if (!source) throw Object.assign(new Error(`local_file_changed: ${entry.path}`), { code: "local_file_changed" });
      return { ...source, ...entry };
    }),
  };
}
