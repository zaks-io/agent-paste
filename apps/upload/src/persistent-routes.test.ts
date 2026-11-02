import { createHash } from "node:crypto";
import { chunkSize, EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { createLocalServices } from "@agent-paste/db";
import { serializeRevisionFileMap, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import { handleRequest } from "./index.js";

const MiB = 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const { repo, auth } = createLocalServices({
    apiKeyPepper: "test-pepper",
    billingEnabled: true,
    fileMapStore: {
      async write(map) {
        const bytes = serializeRevisionFileMap(map);
        const sha256 = digest(bytes);
        return {
          sha256,
          size_bytes: bytes.length,
          r2_key: workspaceBlobObjectKeyFor({ workspaceId: map.workspace_id, sha256 }),
        };
      },
    },
  });
  const admin = { type: "admin" as const, id: "route-test" };
  const ws = await repo.createWorkspace({
    actor: admin,
    idempotencyKey: crypto.randomUUID(),
    email: "routes@example.com",
  });
  const credential = await repo.createApiKey({
    actor: admin,
    idempotencyKey: crypto.randomUUID(),
    workspaceId: ws.id,
    name: "test",
  });
  const objects = new Map<string, { bytes: Uint8Array; metadata: Record<string, string> }>();
  const head = vi.fn(async (key: string) => {
    const object = objects.get(key);
    return object ? { size: object.bytes.length } : null;
  });
  const env: Env = {
    AUTH: auth,
    DB: repo,
    UPLOAD_SIGNING_SECRET: "upload-test-secret",
    ARTIFACT_BYTES_ENCRYPTION_KEY: "encryption-test-secret",
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACTS: {
      head,
      async put(key, value, options) {
        if (options?.onlyIf && objects.has(key)) return null;
        if (!(value instanceof Uint8Array)) throw new Error("expected encrypted bytes");
        objects.set(key, { bytes: value.slice(), metadata: options?.customMetadata ?? {} });
        return {};
      },
      async get(key) {
        const o = objects.get(key);
        return o ? { size: o.bytes.length, body: o.bytes, customMetadata: o.metadata } : null;
      },
    },
  };
  const call = (path: string, body?: unknown, key = crypto.randomUUID()) =>
    handleRequest(
      new Request(`https://upload.test/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${credential.secret}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
  const put = (url: string, bytes: Uint8Array) =>
    handleRequest(
      new Request(url, {
        method: "PUT",
        headers: { "content-length": String(bytes.length) },
        body: bytes as Uint8Array<ArrayBuffer>,
      }),
      env,
    );
  const create = (files: unknown[], extra = {}) =>
    call("upload-sessions", {
      title: "test",
      entrypoint: "index.html",
      commit: { guard: "snapshot", snapshot: { prefix: null, sha256: EMPTY_TREE_SNAPSHOT_SHA256 } },
      files,
      ...extra,
    });
  return { repo, ws, env, objects, head, call, put, create };
}
type Target = { status: string; path: string; chunk_index?: number; put_url?: string };
async function uploadTarget(f: Awaited<ReturnType<typeof fixture>>, t: Target, bytes: Uint8Array) {
  if (!t.put_url) throw new Error("missing target");
  const response = await f.put(t.put_url, bytes);
  expect(response.status, await response.text()).toBe(204);
}

describe("persistent upload Worker routes", () => {
  it("appends, resumes chunk targets, verifies the full file, and finalizes without object HEAD requests", async () => {
    const f = await fixture();
    const text = new TextEncoder().encode("<html>test</html>");
    const bytes = new Uint8Array(11 * MiB).fill(7);
    const shas = [0, 1, 2].map((i) => digest(bytes.subarray(i * 4 * MiB, Math.min(bytes.length, (i + 1) * 4 * MiB))));
    const created = await f.create([{ path: "index.html", size_bytes: text.length, sha256: digest(text) }], {
      more_files: true,
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { upload_session_id: string; files: Target[]; sealed: boolean };
    expect(session.sealed).toBe(false);
    const sid = session.upload_session_id;
    const outOfOrder = await f.call(`upload-sessions/${sid}/file-batches`, {
      batch_index: 2,
      files: [],
      more_files: false,
    });
    expect(outOfOrder.status).toBe(400);
    expect(await outOfOrder.json()).toMatchObject({ error: { details: { expected_batch_index: 1 } } });
    const batchKey = crypto.randomUUID();
    const append = await f.call(
      `upload-sessions/${sid}/file-batches`,
      {
        batch_index: 1,
        files: [
          {
            path: "movie.bin",
            size_bytes: bytes.length,
            sha256: digest(bytes),
            chunks: { chunk_bytes: 4 * MiB, sha256: shas },
          },
        ],
        more_files: false,
      },
      batchKey,
    );
    expect(append.status, await append.clone().text()).toBe(200);
    const batch = (await append.json()) as { sealed: boolean; next_batch_index: number; files: Target[] };
    expect(batch.sealed).toBe(true);
    expect(batch.next_batch_index).toBe(2);
    expect(batch.files.map((t) => t.chunk_index)).toEqual([0, 1, 2]);
    const replay = await f.call(`upload-sessions/${sid}/file-batches`, { malformed: true }, batchKey);
    expect(replay.status).toBe(200);
    await uploadTarget(f, session.files[0] as Target, text);
    await uploadTarget(f, batch.files[0] as Target, bytes.subarray(0, 4 * MiB));
    const incomplete = await f.call(`upload-sessions/${sid}/file-completions`, { paths: ["movie.bin"] });
    expect(incomplete.status).toBe(409);
    const resume = await f.call(`upload-sessions/${sid}/targets?limit=1`);
    expect(resume.status).toBe(200);
    const page = (await resume.json()) as {
      targets: Target[];
      remaining: { chunks: number; bytes: number };
      page_info: { next_cursor: string };
    };
    expect(page.remaining).toMatchObject({ chunks: 2, bytes: 7 * MiB });
    expect(page.targets[0]?.chunk_index).toBe(1);
    const next = await f.call(
      `upload-sessions/${sid}/targets?limit=1&cursor=${encodeURIComponent(page.page_info.next_cursor)}`,
    );
    expect(((await next.json()) as { targets: Target[] }).targets[0]?.chunk_index).toBe(2);
    for (const target of batch.files.slice(1)) {
      const i = target.chunk_index ?? 0;
      await uploadTarget(f, target, bytes.subarray(i * 4 * MiB, Math.min(bytes.length, (i + 1) * 4 * MiB)));
    }
    const completionKey = crypto.randomUUID();
    const complete = await f.call(`upload-sessions/${sid}/file-completions`, { paths: ["movie.bin"] }, completionKey);
    expect(complete.status, await complete.clone().text()).toBe(200);
    expect(await complete.json()).toMatchObject({
      files: [{ sha256: digest(bytes), size_bytes: bytes.length, status: "verified" }],
    });
    const final = await f.call(`upload-sessions/${sid}/finalize`, {});
    expect(final.status, await final.clone().text()).toBe(200);
    expect(await final.json()).toMatchObject({ status: "ready", file_count: 2 });
    expect(f.head).not.toHaveBeenCalled();
    f.env.ACTOR_RATE_LIMIT = { limit: async () => ({ success: false }) };
    const completionReplay = await f.call(
      `upload-sessions/${sid}/file-completions`,
      { paths: ["ignored-on-replay"] },
      completionKey,
    );
    expect(completionReplay.status).toBe(200);
    expect(await completionReplay.json()).toMatchObject({ files: [{ path: "movie.bin", status: "verified" }] });

    expect((await f.put((batch.files[0] as Target).put_url as string, bytes.subarray(0, 4 * MiB))).status).toBe(409);
  }, 60_000);

  it("rejects mismatching full-file digests after successful chunk PUTs and reuses uploaded chunks on retry", async () => {
    const f = await fixture();
    const bytes = new Uint8Array(11 * MiB).fill(3);
    const shas = [0, 1, 2].map((i) => digest(bytes.subarray(i * 4 * MiB, Math.min(bytes.length, (i + 1) * 4 * MiB))));
    const file = {
      path: "index.html",
      size_bytes: bytes.length,
      sha256: "f".repeat(64),
      chunks: { chunk_bytes: 4 * MiB, sha256: shas },
    };
    const created = await f.create([file]);
    expect(created.status).toBe(200);
    const s = (await created.json()) as { upload_session_id: string; files: Target[] };
    for (const t of s.files) {
      const i = t.chunk_index ?? 0;
      await uploadTarget(f, t, bytes.subarray(i * 4 * MiB, Math.min(bytes.length, (i + 1) * 4 * MiB)));
    }
    const complete = await f.call(`upload-sessions/${s.upload_session_id}/file-completions`, { paths: ["index.html"] });
    expect(complete.status).toBe(422);
    expect(await complete.json()).toMatchObject({
      error: { code: "file_digest_mismatch", details: { path: "index.html" } },
    });
    expect(f.repo.contentBlobs.get(`${f.ws.id}:${file.sha256}:${file.size_bytes}`)).toBeUndefined();
    const finalized = await f.call(`upload-sessions/${s.upload_session_id}/finalize`, {});
    expect(finalized.status).toBe(409);
    const retry = await f.create([{ ...file, sha256: digest(bytes) }]);
    const good = (await retry.json()) as { upload_session_id: string; files: Target[] };
    expect(good.files).toEqual([{ status: "verify_required", path: "index.html" }]);
    expect(
      (await f.call(`upload-sessions/${good.upload_session_id}/file-completions`, { paths: ["index.html"] })).status,
    ).toBe(200);
    const reused = await f.create([{ ...file, sha256: digest(bytes) }]);
    expect(((await reused.json()) as { files: Target[] }).files).toEqual([{ status: "reused", path: "index.html" }]);
  }, 60_000);

  it("streams completion of a 250 MiB file through ordinary four MiB workspace blobs", async () => {
    const f = await fixture();
    const size = 250 * MiB;
    const block = new Uint8Array(4 * MiB).fill(11);
    const tail = block.subarray(0, 2 * MiB);
    const shas = Array.from({ length: 63 }, (_, i) => digest(i === 62 ? tail : block));
    const full = createHash("sha256");
    for (let i = 0; i < 63; i++) full.update(i === 62 ? tail : block);
    const expected = full.digest("hex");
    const create = await f.create([
      { path: "index.html", size_bytes: size, sha256: expected, chunks: { chunk_bytes: 4 * MiB, sha256: shas } },
    ]);
    expect(create.status).toBe(200);
    const s = (await create.json()) as { upload_session_id: string; files: Target[] };
    for (const t of s.files)
      await uploadTarget(f, t, chunkSize(size, t.chunk_index ?? 0) === tail.length ? tail : block);
    const complete = await f.call(`upload-sessions/${s.upload_session_id}/file-completions`, { paths: ["index.html"] });
    expect(complete.status, await complete.clone().text()).toBe(200);
    expect(await complete.json()).toMatchObject({ files: [{ sha256: expected, size_bytes: size }] });
    expect(f.objects.size).toBe(2);
    expect(f.repo.contentBlobChunks.size).toBe(63);
  }, 120_000);

  it("preserves Free ten MiB and Pro twenty-five MiB legacy single PUTs", async () => {
    const f = await fixture();
    const body = (size: number) => ({
      title: "legacy",
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: size }],
    });
    expect((await f.call("upload-sessions", body(10 * MiB))).status).toBe(200);
    const capped = await f.call("upload-sessions", body(10 * MiB + 1));
    expect(capped.status).toBe(400);
    expect(await capped.json()).toMatchObject({ error: { code: "file_size_cap_exceeded" } });
    const ws = f.repo.workspaces.get(f.ws.id);
    if (!ws) throw new Error();
    f.repo.workspaces.set(ws.id, { ...ws, plan: "pro" });
    const large = await f.call("upload-sessions", body(25 * MiB));
    expect(large.status).toBe(200);
    expect(((await large.json()) as { files: Target[] }).files[0]?.status).toBe("upload_required");
    expect((await f.call("upload-sessions", body(25 * MiB + 1))).status).not.toBe(200);
    const guarded = await f.create([{ path: "index.html", size_bytes: 10 * MiB + 1, sha256: "a".repeat(64) }]);
    expect(guarded.status).not.toBe(200);
  });
});
