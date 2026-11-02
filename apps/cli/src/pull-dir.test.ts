import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { root } from "@openclaw/fs-safe/root";
import { __setFsSafeTestHooksForTest } from "@openclaw/fs-safe/test-hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pullCache, pullCacheKey } from "./pull-cache.js";
import { diskPullStore } from "./pull-dir.js";

let directory: string;
let prior: string | undefined;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pull-store-"));
  prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
});
afterEach(async () => {
  __setFsSafeTestHooksForTest(undefined);
  vi.restoreAllMocks();
  if (prior === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prior;
  await fs.rm(directory, { recursive: true, force: true });
});
const meta = { etag: '"digest"', revisionId: "revision", sha256: "a".repeat(64) };
async function fixture() {
  const output = path.join(directory, "output");
  await fs.mkdir(output);
  const safe = await root(output, { symlinks: "reject", hardlinks: "reject" });
  const store = diskPullStore(safe);
  const stage = async (filename: string) => {
    const writer = await store.begin(filename, meta, false);
    await writer.write(new TextEncoder().encode("downloaded"));
    await writer.close();
  };
  return { output, safe, store, stage };
}
it("preserves unrelated old partial and metadata filenames and accepts them as remote names", async () => {
  const f = await fixture();
  for (const name of ["report.txt.agent-paste-partial", "report.txt.agent-paste-partial.json"])
    await fs.writeFile(path.join(f.output, name), `user ${name}`);
  expect(await f.store.partial("report.txt")).toBeNull();
  await f.stage("report.txt");
  await f.store.commit("report.txt", false);
  for (const name of ["report.txt.agent-paste-partial", "report.txt.agent-paste-partial.json"])
    expect(await fs.readFile(path.join(f.output, name), "utf8")).toBe(`user ${name}`);
  await f.stage("legitimate.agent-paste-partial");
  await f.store.commit("legitimate.agent-paste-partial", false);
  expect(await fs.readFile(path.join(f.output, "legitimate.agent-paste-partial"), "utf8")).toBe("downloaded");
});
it("resumes only owned cache files across store instances, then cleans the cache", async () => {
  const f = await fixture();
  await f.stage("report.txt");
  const resumed = diskPullStore(f.safe);
  expect(await resumed.partial("report.txt")).toMatchObject({ ...meta, sizeBytes: 10 });
  const writer = await resumed.begin("report.txt", meta, true);
  await writer.write(new TextEncoder().encode(" again"));
  await writer.close();
  await resumed.commit("report.txt", false);
  expect(await fs.readFile(path.join(f.output, "report.txt"), "utf8")).toBe("downloaded again");
  expect(await resumed.partial("report.txt")).toBeNull();
});
it("does not replace a destination created during commit without overwrite", async () => {
  const f = await fixture();
  await f.stage("report.txt");
  let raced = false;
  __setFsSafeTestHooksForTest({
    afterPreOpenLstat: async (filename) => {
      if (!raced && filename.endsWith(".data")) {
        raced = true;
        await fs.writeFile(path.join(f.output, "report.txt"), "concurrent user file");
      }
    },
  });
  await expect(f.store.commit("report.txt", false)).rejects.toMatchObject({ code: "local_conflict" });
  expect(raced).toBe(true);
  expect(await fs.readFile(path.join(f.output, "report.txt"), "utf8")).toBe("concurrent user file");
  expect(await f.store.partial("report.txt")).toMatchObject({ sizeBytes: 10 });
  __setFsSafeTestHooksForTest(undefined);
  await f.store.commit("report.txt", true);
  expect(await fs.readFile(path.join(f.output, "report.txt"), "utf8")).toBe("downloaded");
});

it("preserves an untracked cache file and a replacement of a tracked cache inode", async () => {
  const f = await fixture();
  const cache = await pullCache(f.safe);
  const untracked = `${pullCacheKey("untracked.txt")}.data`;
  await cache.create(untracked, "unowned content");
  await expect(f.store.removePartial("untracked.txt")).rejects.toThrow("unowned_pull_cache_file");
  expect(await cache.readText(untracked)).toBe("unowned content");
  await f.stage("report.txt");
  const tracked = `${pullCacheKey("report.txt")}.data`;
  await cache.move(tracked, "owned-original.data");
  await cache.create(tracked, "replacement content");
  await expect(f.store.removePartial("report.txt")).rejects.toThrow("unowned_pull_cache_file");
  expect(await cache.readText(tracked)).toBe("replacement content");
});

it("preserves a replacement destination during the pinned installation write", async () => {
  const f = await fixture();
  await f.stage("report.txt");
  const open = f.safe.openWritable.bind(f.safe);
  let raced = false;
  vi.spyOn(f.safe, "openWritable").mockImplementation(async (name, options) => {
    const opened = await open(name, options);
    if (!raced) {
      raced = true;
      await fs.rename(path.join(f.output, name), path.join(f.output, "created-original"));
      await fs.writeFile(path.join(f.output, name), "replacement user file");
    }
    return opened;
  });
  await expect(f.store.commit("report.txt", false)).rejects.toMatchObject({ code: "local_conflict" });
  expect(await fs.readFile(path.join(f.output, "report.txt"), "utf8")).toBe("replacement user file");
  expect(await f.store.partial("report.txt")).toMatchObject({ sizeBytes: 10 });
});
