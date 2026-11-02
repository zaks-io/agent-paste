import { CHUNK_BYTES } from "@agent-paste/config";
import { describe, expect, it, vi } from "vitest";
import { readStoredFilePrefix, type StoredFileRef, streamStoredFile } from "./stored-file-reader.js";
import {
  seedEncryptedRevisionFile,
  seedEncryptedWorkspaceBlob,
  testArtifactBytesKeyRing,
} from "./test-helpers/encrypted-artifact-fixture.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const ring = testArtifactBytesKeyRing();

async function fixture() {
  const sizes = [CHUNK_BYTES, CHUNK_BYTES, 7];
  const chunks = sizes.map((sizeBytes, i) => ({ sha256: String(i + 1).repeat(64), sizeBytes }));
  const objects = await Promise.all(
    chunks.map((chunk, i) =>
      seedEncryptedWorkspaceBlob({
        workspaceId,
        sha256: chunk.sha256,
        plaintext: new Uint8Array(chunk.sizeBytes).fill(i + 1),
      }),
    ),
  );
  const get = vi.fn(async (key: string) => {
    const object = objects.find((entry) => entry.objectKey === key);
    return object ? { body: object.body, size: object.body.length, customMetadata: object.customMetadata } : null;
  });
  const file: StoredFileRef = { format: "chunked-v1", sizeBytes: sizes.reduce((a, b) => a + b), chunks };
  return { file, objects, input: { workspaceId, ring, file, r2: { get } }, get };
}

async function collect(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("stored-file reader", () => {
  it("streams in order under backpressure and reports emitted bytes", async () => {
    const f = await fixture();
    const onBytes = vi.fn();
    const reader = streamStoredFile({ ...f.input, onBytes }).getReader();
    expect(f.get).not.toHaveBeenCalled();
    for (const [index, size] of [CHUNK_BYTES, CHUNK_BYTES, 7].entries()) {
      const result = await reader.read();
      expect(result.value?.length).toBe(size);
      expect(result.value?.[0]).toBe(index + 1);
      expect(f.get).toHaveBeenCalledTimes(index + 1);
    }
    expect((await reader.read()).done).toBe(true);
    expect(onBytes.mock.calls.flat().reduce((a, b) => a + b, 0)).toBe(f.file.sizeBytes);
  });
  it("fetches only overlapping range chunks and exact prefix bytes", async () => {
    const f = await fixture();
    const bytes = await collect(
      streamStoredFile({ ...f.input, range: { start: CHUNK_BYTES - 2, endInclusive: CHUNK_BYTES + 2 } }),
    );
    expect([...bytes]).toEqual([1, 1, 2, 2, 2]);
    expect(f.get).toHaveBeenCalledTimes(2);
    f.get.mockClear();
    expect([...(await readStoredFilePrefix(f.input, 3))]).toEqual([1, 1, 1]);
    expect(f.get).toHaveBeenCalledTimes(1);
  });
  it("cancels before a read or during an in-flight read without fetching later chunks", async () => {
    const f = await fixture();
    const early = streamStoredFile(f.input);
    await early.cancel();
    expect(f.get).not.toHaveBeenCalled();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const original = f.get.getMockImplementation();
    f.get.mockImplementation(async (key) => {
      markStarted();
      return original ? original(key) : null;
    });
    const reader = streamStoredFile(f.input).getReader();
    const pending = reader.read();
    await started;
    await reader.cancel();
    expect((await pending).done).toBe(true);
    expect(f.get).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "corrupt", "short", "long"])("aborts on a %s chunk without padding", async (failure) => {
    const f = await fixture();
    const second = f.objects[1];
    if (failure === "corrupt") second.body[second.body.length - 1] ^= 1;
    if (failure === "short" || failure === "long") {
      const replacement = await seedEncryptedWorkspaceBlob({
        workspaceId,
        sha256: "2".repeat(64),
        plaintext: new Uint8Array(CHUNK_BYTES + (failure === "short" ? -1 : 1)),
      });
      Object.assign(second, replacement);
    }
    if (failure === "missing") f.objects.splice(1, 1);
    const reader = streamStoredFile(f.input).getReader();
    expect((await reader.read()).value?.length).toBe(CHUNK_BYTES);
    await expect(reader.read()).rejects.toThrow();
    expect(f.get).toHaveBeenCalledTimes(2);
  });
  it("reads legacy revision encryption and workspace blobs through the same single-file path", async () => {
    const objects = [
      await seedEncryptedRevisionFile({
        workspaceId,
        artifactId: "art_1",
        revisionId: "rev_1",
        path: "text.txt",
        plaintext: "hello",
      }),
      await seedEncryptedWorkspaceBlob({ workspaceId, sha256: "a".repeat(64), plaintext: "hello" }),
    ];
    for (const object of objects) {
      const bytes = await collect(
        streamStoredFile({
          workspaceId,
          ring,
          file: { format: "single", objectKey: object.objectKey, sizeBytes: 5 },
          r2: {
            async get() {
              return { ...object, size: object.body.length };
            },
          },
          range: { start: 1, endInclusive: 3 },
        }),
      );
      expect(new TextDecoder().decode(bytes)).toBe("ell");
    }
  });
  it("rejects invalid geometry and ranges synchronously", async () => {
    const f = await fixture();
    expect(() => streamStoredFile({ ...f.input, range: { start: 0, endInclusive: f.file.sizeBytes } })).toThrow();
    expect(() => streamStoredFile({ ...f.input, file: { format: "chunked-v1", sizeBytes: 1, chunks: [] } })).toThrow();
  });
});
