import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Root, root } from "@openclaw/fs-safe/root";
import { configDir } from "./credentials.js";
import { MAX_FILE_BYTES } from "./local.js";

// The index points to a directory created exclusively by this CLI, outside the
// download namespace. A remote filename can never select transfer metadata.
export async function pullCache(destination: Root): Promise<Root> {
  const directory = path.join(configDir(), "pulls");
  const relative = path.relative(destination.rootReal, directory);
  if (!relative.startsWith(`..${path.sep}`) && relative !== "..")
    throw new Error("Download output must not contain the CLI configuration directory");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const index = await root(directory, { symlinks: "reject", hardlinks: "reject", maxBytes: 4096 });
  const canonicalRelative = path.relative(destination.rootReal, index.rootReal);
  if (!canonicalRelative.startsWith(`..${path.sep}`) && canonicalRelative !== "..")
    throw new Error("Download output must not contain the CLI configuration directory");
  const key = createHash("sha256").update(destination.rootReal).digest("hex");
  const name = `${key}.json`;
  if (!(await index.exists(name))) {
    const created = await fs.mkdtemp(path.join(directory, "data-"));
    const safe = await root(created, { symlinks: "reject", hardlinks: "reject" });
    await safe.createJson("owner.json", { key, destination: destination.rootReal }, { mode: 0o600 });
    try {
      await index.createJson(name, { directory: path.basename(created) }, { mode: 0o600 });
    } catch (error) {
      // A concurrent first pull may have installed its own index. Never remove
      // a directory or file whose identity this invocation did not create.
      if ((error as { code?: string }).code !== "already-exists") throw error;
    }
  }
  const record = await index.readJson<{ directory: string }>(name);
  if (!/^data-[A-Za-z0-9]+$/.test(record.directory)) throw new Error("invalid_pull_cache_owner");
  const safe = await root(await index.resolve(record.directory), {
    symlinks: "reject",
    hardlinks: "reject",
    maxBytes: MAX_FILE_BYTES,
  });
  const owner = await safe.readJson<{ key: string; destination: string }>("owner.json", { maxBytes: 4096 });
  if (owner.key !== key || owner.destination !== destination.rootReal) throw new Error("invalid_pull_cache_owner");
  return safe;
}
export function pullCacheKey(remotePath: string): string {
  return createHash("sha256").update(remotePath).digest("hex");
}
