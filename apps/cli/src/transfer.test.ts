import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiClient } from "@agent-paste/api-client";
import { mvpUsagePolicy } from "@agent-paste/contracts/workspace";
import { root as safeRoot } from "@openclaw/fs-safe/root";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./index.js";
import { scanLocalPath } from "./local-scan.js";
import { diskPullStore } from "./pull-dir.js";

const aid = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const rid = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uid = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const date = "2026-12-01T00:00:00.000Z";
const hash = (b: Uint8Array | string) =>
  createHash("sha256")
    .update(typeof b === "string" ? b : new Uint8Array(b))
    .digest("hex");
let directory: string;
let prior: string | undefined;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "w3-transfer-"));
  prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
  vi.spyOn(process.stdout, "write").mockImplementation((_s, cb) => {
    cb?.();
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prior === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prior;
  await fs.rm(directory, { recursive: true, force: true });
});
function fakeEndpoint() {
  const remote = new Map<string, Uint8Array>([
    ["index.html", new TextEncoder().encode("old")],
    ["keep.bin", new Uint8Array([1, 2, 3])],
  ]);
  const events: string[] = [];
  let session: Record<string, unknown> | undefined;
  let pending: { path: string; size_bytes: number; sha256: string }[] = [];
  let fail = false;
  let puts = 0;
  const result = { artifact_id: aid, revision_id: rid, title: "Site", url: "https://site.test/", expires_at: date };
  const view = () => ({
    ...result,
    created_at: date,
    entrypoint: "index.html",
    retention: "temporary",
    effective_expires_at: date,
    revision_content_url: "https://content.test/v/token/index.html",
    files: [...remote].map(([path, b]) => ({
      path,
      sha256: hash(b),
      size_bytes: b.length,
      content_type: path.endsWith("html") ? "text/html; charset=utf-8" : "application/octet-stream",
      url: `https://content.test/v/token/${path}`,
    })),
    safety_warnings: [],
    bundle: { status: "disabled" },
  });
  const targets = () =>
    pending.map((f) => ({
      status: "upload_required",
      path: f.path,
      put_url: `https://upload.test/put/${encodeURIComponent(f.path)}`,
      expires_at: date,
      required_headers: {},
    }));
  const client = new ApiClient({
    apiBaseUrl: "https://api.test",
    uploadBaseUrl: "https://upload.test",
    auth: { type: "api_key", apiKey: "fixture" },
    fetch: vi.fn(async (url, init) => {
      const u = new URL(String(url));
      events.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname === "/v1/usage-policy")
        return Response.json({
          file_size_cap_bytes: 262144000,
          artifact_size_cap_bytes: 2147483648,
          bundle_size_cap_bytes: 16777216,
          bundles_enabled: true,
          file_count_cap: 10000,
          actor_rate_limit_per_minute: 60,
          workspace_burst_cap_per_minute: 300,
          upload_session_ttl_seconds: 86400,
          default_ttl_seconds: 2592000,
          min_ttl_seconds: 86400,
          max_ttl_seconds: 7776000,
          live_artifacts_cap: 50,
          live_update_enabled: false,
          daily_new_artifact_allowance: 100,
          lifetime_revision_ceiling: 2147483647,
        });
      if (u.pathname === "/v1/usage")
        return Response.json({
          budget_bytes: 100,
          used_bytes: 0,
          reserved_bytes: 0,
          breakdown: { blob_bytes: 0, legacy_file_bytes: 0, bundle_bytes: 0, file_entry_bytes: 0 },
          pins: { pinned_count: 0, pin_allowance: 1 },
        });
      if (u.pathname === "/v1/whoami")
        return Response.json({
          actor: { type: "api_key", id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", name: "Fixture" },
          workspace: { id: "00000000-0000-4000-8000-000000000000", name: "Fixture", created_at: date },
          scopes: ["read", "publish"],
          usage_policy: mvpUsagePolicy,
        });
      if (u.pathname.endsWith("/agent-view")) return Response.json(view());
      if (u.pathname.endsWith("/files"))
        return Response.json({
          artifact_id: aid,
          revision_id: rid,
          file_count: remote.size,
          size_bytes: [...remote.values()].reduce((n, b) => n + b.length, 0),
          entrypoint: "index.html",
          title: "Site",
          items: [...remote].map(([path, b]) => ({
            path,
            sha256: hash(b),
            size_bytes: b.length,
            content_type: path.endsWith("html") ? "text/html; charset=utf-8" : "application/octet-stream",
            format: "single",
          })),
          page_info: { has_more: false, next_cursor: null },
        });
      if (u.pathname === "/v1/upload-sessions") {
        session = JSON.parse(String(init?.body));
        pending = (session?.files as typeof pending).filter(
          (f) => !remote.has(f.path) || hash(remote.get(f.path)!) !== f.sha256,
        );
        return Response.json({
          upload_session_id: uid,
          artifact_id: aid,
          revision_id: rid,
          status: "pending",
          expires_at: date,
          files: targets(),
          sealed: true,
          next_batch_index: 1,
        });
      }
      if (u.pathname.endsWith("/targets"))
        return Response.json({
          upload_session_id: uid,
          status: "pending",
          sealed: true,
          expires_at: date,
          remaining: { files: pending.length, chunks: 0, bytes: 0, unverified_files: 0 },
          targets: targets(),
          page_info: { has_more: false, next_cursor: null },
        });
      if (u.pathname.startsWith("/put/")) {
        if (fail) throw new Error("simulated process interruption");
        const path = decodeURIComponent(u.pathname.slice(5));
        remote.set(path, new Uint8Array(init?.body as Uint8Array));
        pending = pending.filter((f) => f.path !== path);
        puts++;
        return new Response(null, { status: 204 });
      }
      if (u.pathname.endsWith("/finalize"))
        return Response.json({
          status: "ready",
          upload_session_id: uid,
          artifact_id: aid,
          revision_id: rid,
          file_count: 1,
          deletion_count: 0,
        });
      if (u.pathname.endsWith("/publish")) {
        for (const d of (session?.deletions ?? []) as { path: string }[]) remote.delete(d.path);
        return Response.json({
          ...result,
          revision_number: 2,
          retention: "temporary",
          pinned_at: null,
          effective_expires_at: date,
          no_change: false,
          changes: { added: 0, changed: 1, removed: 0 },
        });
      }
      throw new Error(`Unexpected fake endpoint ${u.pathname}`);
    }),
  });
  return {
    client,
    remote,
    events,
    getSession: () => session,
    getPuts: () => puts,
    interrupt: (value: boolean) => {
      fail = value;
    },
  };
}
describe("CLI transfers through the HTTP client", () => {
  it("uploads only a selected file, preserves omitted bytes, and resumes saved guards", async () => {
    const fixture = fakeEndpoint();
    const filename = path.join(directory, "changed.html");
    await fs.writeFile(filename, "new content");
    fixture.interrupt(true);
    await expect(
      main(["publish", filename, "--artifact-id", aid, "--to", "index.html", "--json"], fixture.client),
    ).rejects.toThrow("simulated");
    const first = fixture.getSession();
    fixture.interrupt(false);
    await main(["publish", filename, "--artifact-id", aid, "--to", "index.html", "--json"], fixture.client);
    expect(fixture.getSession()).toEqual(first);
    expect(fixture.getSession()).toMatchObject({
      commit: { guard: "paths" },
      files: [{ path: "index.html", expect: { sha256: hash("old"), size_bytes: 3 } }],
    });
    expect(fixture.remote.get("keep.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fixture.getPuts()).toBe(1);
  });
  it("dry-run and no-op create no upload session", async () => {
    const f = fakeEndpoint();
    const filename = path.join(directory, "index.html");
    await fs.writeFile(filename, "old");
    await main(
      ["publish", filename, "--artifact-id", aid, "--to", "index.html", "--dry-run", "--json"],
      f.client,
    ).catch((e) => {
      throw e;
    });
    expect(f.events.some((e) => e.includes("upload-sessions"))).toBe(false);
    await main(["publish", filename, "--artifact-id", aid, "--to", "index.html", "--json"], f.client);
    expect(f.getPuts()).toBe(0);
    expect(f.events.some((e) => e.startsWith("POST"))).toBe(false);
  });
  it.each([
    ["--mirror"],
    ["--to", "a"],
    ["--delete", "a"],
  ])("validates partial flags before network: %s", async (...flags) => {
    const f = fakeEndpoint();
    await expect(main(["publish", "missing", ...flags, "--json"], f.client)).rejects.toMatchObject({ status: 400 });
    expect(f.events).toEqual([]);
  });
  it("requires --yes for delete and forwards pin/unpin/list/usage", async () => {
    const operations = { delete: vi.fn(), pin: vi.fn(), unpin: vi.fn(), list: vi.fn() };
    const client = { artifacts: operations, usage: { get: vi.fn() } } as unknown as ApiClient;
    await expect(main(["delete", aid], client)).rejects.toMatchObject({ status: 400 });
    expect(operations.delete).not.toHaveBeenCalled();
    await main(["delete", aid, "--yes", "--json"], client);
    await main(["pin", aid, "--json"], client);
    await main(["unpin", aid, "--json"], client);
    await main(["list", "--cursor", "page", "--json"], client);
    await main(["usage", "--json"], client);
    expect(operations.list).toHaveBeenCalledWith({ cursor: "page" });
    expect(operations.pin).toHaveBeenCalledWith(aid, expect.any(String));
  });
});
describe("bounded local disk transfer", () => {
  it("scans in blocks, keeps full and chunk digests, excludes globs, detects changes", async () => {
    const file = path.join(directory, "big.bin");
    await fs.writeFile(file, "");
    await fs.truncate(file, 11 * 1024 * 1024);
    await fs.writeFile(path.join(directory, "skip.txt"), "skip");
    const readFile = vi.spyOn(fs, "readFile");
    const sources = await scanLocalPath(directory, ["*.txt"]);
    expect(readFile).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.chunkSha256).toHaveLength(3);
    await fs.writeFile(file, "changed");
    await expect(sources[0]?.readRange(0, 4194304)).rejects.toMatchObject({ code: "local_file_changed" });
  });
  it("refuses to write downloads through symlinks and preserves unrelated files", async () => {
    const output = path.join(directory, "out");
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, "keep"), "keep");
    await fs.symlink(directory, path.join(output, "escape"));
    const store = diskPullStore(await safeRoot(output, { symlinks: "reject", hardlinks: "reject" }));
    await expect(store.begin("escape/stolen", { etag: '"x"', revisionId: "r", sha256: "a" }, false)).rejects.toThrow();
    expect(await fs.readFile(path.join(output, "keep"), "utf8")).toBe("keep");
  });
});
