import { createHash } from "node:crypto";
import { type RevisionFileMapV1, serializeRevisionFileMap, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import {
  seedEncryptedWorkspaceBlob,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const revisionId = "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CHUNK = 4 * 1024 * 1024;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Stored = { body: Uint8Array; customMetadata: Record<string, string> };
async function fixture(
  options: { path?: string; text?: string; revisionId?: string; chunked?: boolean; large?: boolean } = {},
) {
  const path = options.path ?? "file.txt";
  const revision = options.revisionId ?? revisionId;
  const plaintext = new TextEncoder().encode(options.text ?? "0123456789");
  const size = options.large ? 250 * 1024 * 1024 : options.chunked ? CHUNK * 2 + 7 : plaintext.length;
  const store = new Map<string, Stored>();
  async function seed(bytes: Uint8Array, digest = sha(bytes)) {
    const object = await seedEncryptedWorkspaceBlob({ workspaceId, sha256: digest, plaintext: bytes });
    store.set(object.objectKey, object);
    return digest;
  }
  const chunked = options.chunked || options.large;
  const hashes: string[] = [];
  const expectedHash = createHash("sha256");
  if (chunked) {
    const full = new Uint8Array(CHUNK).fill(97);
    const fullSha = await seed(full);
    for (let offset = 0; offset < size; offset += CHUNK) {
      const bytes = full.subarray(0, Math.min(CHUNK, size - offset));
      hashes.push(bytes.length === CHUNK ? fullSha : await seed(bytes));
      expectedHash.update(bytes);
    }
  }
  const digest = chunked ? expectedHash.digest("hex") : await seed(plaintext);
  const file = { path, size_bytes: size, sha256: digest, content_type: "text/plain" };
  const map: RevisionFileMapV1 = {
    version: 1,
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revision,
    entrypoint: path,
    files: [
      chunked
        ? { ...file, format: "chunked-v1", chunk_bytes: CHUNK, chunks: hashes }
        : { ...file, format: "single", object_key: workspaceBlobObjectKeyFor({ workspaceId, sha256: digest }) },
    ],
  };
  const mapBytes = serializeRevisionFileMap(map);
  const mapSha = await seed(mapBytes);
  const get = vi.fn(async (key: string) => {
    const object = store.get(key);
    return object
      ? {
          body: new Blob([object.body as BlobPart]).stream(),
          size: object.body.length,
          customMetadata: object.customMetadata,
        }
      : null;
  });
  const metrics = vi.fn();
  const denied = new Set<string>();
  const env: Env = {
    ...testArtifactBytesEncryptionEnv,
    CONTENT_SIGNING_SECRET: "secret",
    ARTIFACTS: { get },
    DENYLIST: {
      async get(key) {
        return denied.has(key) ? "1" : null;
      },
    },
    ARTIFACT_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    ARTIFACT_EVENTS: { writeDataPoint: metrics },
  };
  const payload: ContentTokenPayload = {
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revision,
    exp: Math.floor(Date.now() / 1000) + 3600,
    script_disabled: false,
    file_map: { sha256: mapSha, size_bytes: mapBytes.length },
  };
  async function request(
    headers: HeadersInit = {},
    method = "GET",
    overrides: Partial<ContentTokenPayload> = {},
    requestedPath = path,
  ) {
    const token = await signContentToken({ ...payload, ...overrides }, "secret");
    return handleRequest(new Request(`https://content.test/v/${token}/${requestedPath}`, { method, headers }), env);
  }
  return { request, env, get, store, denied, metrics, map, payload, size, digest, mapSha };
}

describe("map-authorized content", () => {
  it.each([
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=7-9999999999999999999999", 206, "789", "bytes 7-9/10"],
    ["bytes=-9999999999999999999999", 206, "0123456789", "bytes 0-9/10"],
    ["bytes=10-", 416, "", "bytes */10"],
    ["bytes=-0", 416, "", "bytes */10"],
    ["bytes=5-2", 416, "", "bytes */10"],
    ["bytes=0-1,4-5", 200, "0123456789", null],
    ["bytes=nope", 200, "0123456789", null],
    ["items=0-1", 200, "0123456789", null],
  ])("handles %s", async (range, status, body, contentRange) => {
    const f = await fixture();
    const response = await f.request({ range });
    expect(response.status).toBe(status);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-length")).toBe(String(body.length));
  });
  it("requires a strong If-Range match, ignores ranges on HEAD, and handles empty files", async () => {
    const f = await fixture();
    const first = await f.request({}, "HEAD");
    const etag = first.headers.get("etag") as string;
    expect(first.headers.get("content-length")).toBe("10");
    expect(await first.text()).toBe("");
    for (const ifRange of [etag, `W/${etag}`, '"different"', "Thu, 01 Jan 1970 00:00:00 GMT"]) {
      const response = await f.request({ range: "bytes=0-1", "if-range": ifRange });
      expect(response.status).toBe(ifRange === etag ? 206 : 200);
      await response.body?.cancel();
    }
    expect((await f.request({ range: "bytes=0-1" }, "HEAD")).status).toBe(200);
    const empty = await fixture({ text: "" });
    expect((await empty.request({ range: "bytes=0-1" })).status).toBe(416);
  });
  it("ignores ranges for gzip and noindex transformations and preserves headers", async () => {
    const f = await fixture({ path: "index.html", text: "<html><head></head><body>hello</body></html>" });
    const gzip = await f.request({ range: "bytes=0-1", "accept-encoding": "gzip" });
    expect(gzip.status).toBe(200);
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(gzip.headers.has("accept-ranges")).toBe(false);
    const noindex = await f.request({ range: "bytes=0-1" }, "GET", { noindex: true });
    expect(noindex.status).toBe(200);
    expect(await noindex.text()).toContain('name="robots"');
    expect(noindex.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(noindex.headers.get("content-security-policy")).toContain("script-src 'none'");
  });
  it("checks membership, digest, identity, and denylist even on warm caches and conditional requests", async () => {
    const f = await fixture({ text: "unique security fixture" });
    const head = await f.request({}, "HEAD");
    expect(head.status).toBe(200);
    expect((await f.request({}, "GET", {}, "unknown.txt")).status).toBe(404);
    for (const key of [`rd:${revisionId}`, `ad:${artifactId}`, `wsd:${workspaceId}`]) {
      f.denied.add(key);
      expect((await f.request({ "if-none-match": head.headers.get("etag") as string })).status).toBe(404);
      f.denied.delete(key);
    }
    expect((await f.request({}, "GET", { revision_id: "rev_01ARZ3NDEKTSV4RRFFQ69G5FAW" })).status).toBe(404);
    expect((await f.request({}, "GET", { workspace_id: "00000000-0000-4000-8000-000000000002" })).status).toBe(404);
    const badSha = "f".repeat(64);
    const bad = await seedEncryptedWorkspaceBlob({
      workspaceId,
      sha256: badSha,
      plaintext: serializeRevisionFileMap(f.map),
    });
    f.store.set(bad.objectKey, bad);
    expect(
      (await f.request({}, "GET", { file_map: { sha256: badSha, size_bytes: serializeRevisionFileMap(f.map).length } }))
        .status,
    ).toBe(404);
  });
  it("keeps content-hash ETags stable across revisions and retains the one-hour asset policy", async () => {
    const a = await fixture({ path: "asset.css" });
    const b = await fixture({ path: "asset.css", revisionId: "rev_01ARZ3NDEKTSV4RRFFQ69G5FAW" });
    const first = await a.request({}, "HEAD");
    const second = await b.request({ "if-none-match": first.headers.get("etag") as string });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(second.headers.get("cache-control")).toMatch(/max-age=(?:3599|3600)/u);
    expect(second.headers.has("content-length")).toBe(false);
  });
  it("streams selected chunk ranges as identity bytes and counts only emitted bytes", async () => {
    const f = await fixture({ chunked: true });
    const response = await f.request({ range: `bytes=${CHUNK - 2}-${CHUNK + 2}`, "accept-encoding": "gzip" });
    expect(response.status).toBe(206);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(await response.text()).toBe("aaaaa");
    expect(f.get.mock.calls.filter(([key]) => !key.endsWith(f.mapSha))).toHaveLength(2);
    const readBytes = f.metrics.mock.calls.reduce((total, [point]) => total + point.doubles[0], 0);
    expect(readBytes).toBe(5);
  });
  it.each(["missing", "corrupt"])("aborts a chunked response on a %s chunk", async (failure) => {
    const f = await fixture({ chunked: true, path: `${failure}.bin` });
    const entry = f.map.files[0];
    if (entry.format !== "chunked-v1") throw new Error("expected chunks");
    const key = workspaceBlobObjectKeyFor({ workspaceId, sha256: entry.chunks[0] });
    if (failure === "missing") f.store.delete(key);
    else {
      const object = f.store.get(key);
      if (object) object.body[20] ^= 1;
    }
    const response = await f.request();
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
  it("streams a 250 MiB file and selected ranges without reading ahead or buffering the file", async () => {
    const f = await fixture({ large: true, path: "large.bin" });
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(f.size));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing body");
    const hash = createHash("sha256");
    let total = 0;
    for (let index = 0; ; index++) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(value.length).toBeLessThanOrEqual(CHUNK);
      hash.update(value);
      total += value.length;
      // Exactly one map read and one overlapping chunk per consumer read.
      expect(f.get).toHaveBeenCalledTimes(index + 2);
    }
    expect(total).toBe(250 * 1024 * 1024);
    expect(hash.digest("hex")).toBe(f.digest);
    f.get.mockClear();
    const tail = await f.request({ range: "bytes=-17" });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("a".repeat(17));
    expect(f.get).toHaveBeenCalledTimes(1);
    f.get.mockClear();
    const cross = await f.request({ range: `bytes=${CHUNK - 4}-${CHUNK + 4}` });
    expect(await cross.text()).toBe("a".repeat(9));
    expect(f.get).toHaveBeenCalledTimes(2);
  }, 30_000);
});
