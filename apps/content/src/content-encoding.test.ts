import { describe, expect, it } from "vitest";
import { acceptsGzip, gzipBytes, negotiatesGzip } from "./content-encoding.js";

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("acceptsGzip", () => {
  it.each([
    ["gzip", true],
    ["br, gzip, zstd", true],
    ["GZIP;q=0.5", true],
    ["x-gzip", true],
    ["*", true],
    ["br, *;q=0.1", true],
    [null, false],
    ["", false],
    ["identity", false],
    ["br, zstd", false],
    ["gzip;q=0", false],
    ["gzip;q=0, *", false],
    ["*;q=0", false],
    ["gzip;q=junk", false],
  ])("%s -> %s", (header, expected) => {
    expect(acceptsGzip(header)).toBe(expected);
  });
});

describe("negotiatesGzip", () => {
  const gzipRequest = new Request("https://content.test/", { headers: { "accept-encoding": "gzip" } });

  it("compresses text-like paths only", () => {
    expect(negotiatesGzip("index.html", gzipRequest)).toBe(true);
    expect(negotiatesGzip("assets/app.js", gzipRequest)).toBe(true);
    expect(negotiatesGzip("photo.png", gzipRequest)).toBe(false);
    expect(negotiatesGzip("paper.pdf", gzipRequest)).toBe(false);
    expect(negotiatesGzip("blob.bin", gzipRequest)).toBe(false);
  });

  it("requires the request to accept gzip", () => {
    expect(negotiatesGzip("index.html", new Request("https://content.test/"))).toBe(false);
    expect(negotiatesGzip("index.html", undefined)).toBe(false);
  });
});

describe("gzipBytes", () => {
  it("round-trips exact bytes and shrinks repetitive text", async () => {
    const plaintext = new TextEncoder().encode("<p>hello</p>".repeat(500));
    const compressed = await gzipBytes(plaintext);
    expect(compressed.byteLength).toBeLessThan(plaintext.byteLength / 10);
    expect(await gunzip(compressed)).toEqual(plaintext);
  });
});
