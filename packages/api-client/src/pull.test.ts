import { describe, expect, it, vi } from "vitest";
import { type PullStore, type PullTransport, pullPlan } from "./pull-plan.js";
import { pullFiles } from "./pull-transfer.js";
import { digestBytes } from "./transfer-retry.js";

const date = "2026-01-01T00:00:00.000Z";
async function fixture() {
  const bytes = new TextEncoder().encode("complete content");
  const sha = await digestBytes(bytes);
  const file = {
    path: "docs/a.bin",
    sha256: sha,
    size_bytes: bytes.length,
    content_type: "application/octet-stream",
    format: "single",
  };
  const grant = {
    artifact_id: "artifact",
    revision_id: "revision",
    content_base_url: "https://content.test/v/grant/",
    expires_at: date,
    file_count: 1,
    size_bytes: bytes.length,
  };
  let local: Uint8Array | undefined;
  let partial: Uint8Array | undefined;
  let meta = { etag: '"hash"', revisionId: "revision", sha256: sha };
  const store: PullStore = {
    inspect: vi.fn(async () => (local ? { sha256: await digestBytes(local), sizeBytes: local.length } : null)),
    partial: vi.fn(async () => (partial ? { ...meta, sizeBytes: partial.length } : null)),
    begin: vi.fn(async (_p, m, resume) => {
      meta = { ...m, sha256: m.sha256! };
      if (!resume) partial = new Uint8Array();
      return {
        write: async (b: Uint8Array) => {
          const next = new Uint8Array((partial?.length ?? 0) + b.length);
          next.set(partial ?? []);
          next.set(b, next.length - b.length);
          partial = next;
        },
        close: async () => {},
      };
    }),
    verifyPartial: vi.fn(async () => ({ sha256: await digestBytes(partial!), sizeBytes: partial!.length })),
    commit: vi.fn(async () => {
      local = partial;
      partial = undefined;
    }),
    removePartial: vi.fn(async () => {
      partial = undefined;
    }),
  };
  const transport: PullTransport = {
    readGrant: vi.fn(async () => grant as never),
    listFiles: vi.fn(
      async () =>
        ({
          ...grant,
          title: "Title",
          entrypoint: file.path,
          items: [file],
          page_info: { has_more: false, next_cursor: null },
        }) as never,
    ),
    fetchContent: vi.fn(async () => new Response(bytes, { headers: { etag: '"hash"' } })),
  };
  return {
    bytes,
    sha,
    grant,
    file,
    store,
    transport,
    setLocal: (b: Uint8Array) => {
      local = b;
    },
    setPartial: (b: Uint8Array) => {
      partial = b;
    },
    getLocal: () => local,
    getPartial: () => partial,
  };
}
describe("file-wise pull", () => {
  it.each([
    "docs/a.bin.agent-paste-partial",
    "docs/a.bin.agent-paste-partial/child",
    "docs/a.bin.agent-paste-partial.json/child",
  ])("allows legitimate filenames resembling old transfer sidecars: %s", async (collision) => {
    const f = await fixture();
    f.grant.file_count = 2;
    f.grant.size_bytes *= 2;
    f.transport.listFiles = vi.fn(
      async () =>
        ({
          ...f.grant,
          title: "Title",
          entrypoint: f.file.path,
          items: [f.file, { ...f.file, path: collision }],
          page_info: { has_more: false, next_cursor: null },
        }) as never,
    );
    const plan = await pullPlan(f.transport, f.store, { artifactId: "artifact" });
    expect(plan.files.map((file) => file.path)).toContain(collision);
  });
  it("uses one grant, pins listing to its revision and does not fetch content for dry runs", async () => {
    const f = await fixture();
    const input = { artifactId: "artifact", paths: ["docs"], dryRun: true };
    const p = await pullPlan(f.transport, f.store, input);
    await pullFiles(f.transport, f.store, p, input);
    expect(f.transport.readGrant).toHaveBeenCalledOnce();
    expect(f.transport.listFiles).toHaveBeenCalledWith(
      "artifact",
      expect.objectContaining({ revision_id: "revision" }),
    );
    expect(f.transport.fetchContent).not.toHaveBeenCalled();
  });
  it("checks every overwrite conflict before writing any file", async () => {
    const f = await fixture();
    f.setLocal(new Uint8Array([1]));
    const i = { artifactId: "artifact" };
    const p = await pullPlan(f.transport, f.store, i);
    await expect(pullFiles(f.transport, f.store, p, i)).rejects.toMatchObject({ code: "local_conflict" });
    expect(f.store.begin).not.toHaveBeenCalled();
    await pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, { ...i, overwrite: true }), {
      ...i,
      overwrite: true,
    });
    expect(f.getLocal()).toEqual(f.bytes);
  });
  it("resumes partial content with Range and If-Range then verifies before rename", async () => {
    const f = await fixture();
    f.setPartial(f.bytes.slice(0, 4));
    f.transport.fetchContent = vi.fn(
      async () =>
        new Response(f.bytes.slice(4), {
          status: 206,
          headers: { etag: '"hash"', "Content-Range": `bytes 4-${f.bytes.length - 1}/${f.bytes.length}` },
        }),
    );
    const i = { artifactId: "artifact" };
    await pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, i), i);
    expect(f.transport.fetchContent).toHaveBeenCalledWith(expect.any(String), {
      Range: "bytes=4-",
      "If-Range": '"hash"',
    });
    expect(f.getLocal()).toEqual(f.bytes);
    expect(f.store.commit).toHaveBeenCalledOnce();
  });
  it("discards corrupt partials and never renames a digest mismatch", async () => {
    const f = await fixture();
    f.transport.fetchContent = vi.fn(
      async () => new Response(new Uint8Array(f.bytes.length), { headers: { etag: '"hash"' } }),
    );
    const i = { artifactId: "artifact" };
    await expect(pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, i), i)).rejects.toThrow(
      "file_digest_mismatch",
    );
    expect(f.getPartial()).toBeUndefined();
    expect(f.store.commit).not.toHaveBeenCalled();
  });
  it("restarts when If-Range returns 200 and skips matching local bytes", async () => {
    const f = await fixture();
    f.setPartial(new Uint8Array([1]));
    const i = { artifactId: "artifact" };
    await pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, i), i);
    expect(f.store.begin).toHaveBeenCalledWith("docs/a.bin", expect.anything(), false);
    const p = await pullPlan(f.transport, f.store, i);
    expect(p.skipped).toBe(1);
    expect(p.files).toEqual([]);
  });
  it("renews an expired grant for the same revision across concurrent publication", async () => {
    const f = await fixture();
    let n = 0;
    f.transport.fetchContent = vi.fn(async () => {
      if (!n++) throw { status: 403 };
      return new Response(f.bytes, { headers: { etag: '"hash"' } });
    });
    const i = { artifactId: "artifact" };
    await pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, i), i);
    expect(f.transport.readGrant).toHaveBeenLastCalledWith("artifact", "revision");
  });
  it("rejects traversal, changing revision pages, and malformed ranges", async () => {
    const f = await fixture();
    const i = { artifactId: "artifact", paths: ["../escape"] };
    await expect(pullPlan(f.transport, f.store, i)).rejects.toThrow();
    f.setPartial(f.bytes.slice(0, 4));
    f.transport.fetchContent = vi.fn(
      async () =>
        new Response(f.bytes.slice(4), { status: 206, headers: { etag: '"hash"', "Content-Range": "bytes 0-1/2" } }),
    );
    const all = { artifactId: "artifact" };
    await expect(pullFiles(f.transport, f.store, await pullPlan(f.transport, f.store, all), all)).rejects.toThrow(
      "invalid_content_range",
    );
    expect(f.store.begin).not.toHaveBeenCalled();
  });
});
