import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifestCache, manifestCachePath, saveManifestCache } from "./manifest-cache.js";

let prevHome: string | undefined;
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-cache-test-"));
  prevHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});
afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = prevHome;
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("manifest cache", () => {
  it("round-trips a saved manifest", async () => {
    const cache = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      files: [{ path: "a.txt", sha256: "a".repeat(64), size_bytes: 3 }],
    };
    await saveManifestCache("art_1", cache);
    expect(await loadManifestCache("art_1")).toEqual(cache);
  });

  it("returns null on a cache miss (no file)", async () => {
    expect(await loadManifestCache("art_missing")).toBeNull();
  });

  it("treats malformed JSON as a cache miss", async () => {
    const filePath = manifestCachePath("art_bad");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ not json");
    expect(await loadManifestCache("art_bad")).toBeNull();
  });

  it("treats a wrong-shape cache as a cache miss (schema drift)", async () => {
    const filePath = manifestCachePath("art_drift");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ revision_id: 5, files: "nope" }));
    expect(await loadManifestCache("art_drift")).toBeNull();
  });
});
