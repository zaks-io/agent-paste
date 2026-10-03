import {
  seedEncryptedRevisionFile,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const GZIP = { "accept-encoding": "br, gzip, zstd" };
const HTML = `<html><head><title>t</title></head><body>${"<p>repeated</p>".repeat(400)}</body></html>`;

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function servedFile(path: string, plaintext: string | Uint8Array, tokenOverrides: { noindex?: boolean } = {}) {
  const token = await signContentToken(
    {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      paths: [path],
      script_disabled: false,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...tokenOverrides,
    },
    "secret",
  );
  const fixture = await seedEncryptedRevisionFile({
    workspaceId,
    artifactId: "art_1",
    revisionId: "rev_1",
    path,
    plaintext,
  });
  const stored = () => ({
    body: new Blob([fixture.body as BlobPart]).stream(),
    size: fixture.body.byteLength,
    customMetadata: fixture.customMetadata,
  });
  const get = vi.fn(async () => stored());
  const head = vi.fn(async () => ({ ...stored(), body: null }));
  const env: Env = {
    CONTENT_SIGNING_SECRET: "secret",
    ...testArtifactBytesEncryptionEnv,
    DENYLIST: { get: async () => null },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
    ARTIFACTS: { get, head },
  };
  const fetchFile = (init: RequestInit = {}) =>
    handleRequest(new Request(`https://content.test/v/${token}/${path}`, init), env);
  return { fetchFile, get };
}

describe("gzip content responses", () => {
  it("gzips text when the browser accepts it and the body decodes to the exact bytes", async () => {
    const { fetchFile } = await servedFile("index.html", HTML);
    const response = await fetchFile({ headers: GZIP });
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("cache-control")).toBe("private, no-cache, no-transform");
    expect(response.headers.get("content-length")).toBe(String(body.byteLength));
    expect(body.byteLength).toBeLessThan(HTML.length / 10);
    expect(await gunzip(body)).toBe(HTML);
  });

  it("serves identity bytes with the unchanged validator when gzip is not accepted", async () => {
    const { fetchFile } = await servedFile("index.html", HTML);
    for (const headers of [{}, { "accept-encoding": "gzip;q=0, br" }]) {
      const response = await fetchFile({ headers });
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("vary")).toBe("Accept-Encoding");
      expect(response.headers.get("content-length")).toBe(String(HTML.length));
      await expect(response.text()).resolves.toBe(HTML);
    }
    const gzipped = await fetchFile({ headers: GZIP });
    const identity = await fetchFile();
    expect(gzipped.headers.get("etag")).not.toBe(identity.headers.get("etag"));
  });

  it("gzips the noindex-injected HTML rather than the stored bytes", async () => {
    const { fetchFile } = await servedFile("index.html", HTML, { noindex: true });
    const response = await fetchFile({ headers: GZIP });
    const html = await gunzip(new Uint8Array(await response.arrayBuffer()));
    expect(html).toContain('<head><meta name="robots" content="noindex,nofollow">');
  });

  it("leaves already-compressed types untouched", async () => {
    const png = crypto.getRandomValues(new Uint8Array(2048));
    const { fetchFile } = await servedFile("photo.png", png);
    const response = await fetchFile({ headers: GZIP });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("revalidates each representation with its own ETag before reading R2", async () => {
    const { fetchFile, get } = await servedFile("style.css", "body{color:red}".repeat(50));
    const gzipped = await fetchFile({ headers: GZIP });
    const identity = await fetchFile();
    expect(get).toHaveBeenCalledTimes(2);

    const notModified = await fetchFile({
      headers: { ...GZIP, "if-none-match": gzipped.headers.get("etag") as string },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(gzipped.headers.get("etag"));
    expect(notModified.headers.get("vary")).toBe("Accept-Encoding");
    expect(notModified.headers.get("cache-control")).toBe(gzipped.headers.get("cache-control"));
    expect(notModified.headers.get("content-encoding")).toBeNull();
    expect(notModified.headers.get("content-length")).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);

    const crossed = await fetchFile({
      headers: { ...GZIP, "if-none-match": identity.headers.get("etag") as string },
    });
    expect(crossed.status).toBe(200);
    expect(crossed.headers.get("content-encoding")).toBe("gzip");
  });

  it("advertises gzip on HEAD without a content-length it cannot know", async () => {
    const { fetchFile, get } = await servedFile("index.html", HTML);
    const response = await fetchFile({ method: "HEAD", headers: GZIP });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-length")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
