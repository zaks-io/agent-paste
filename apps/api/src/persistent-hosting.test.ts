import { createHash } from "node:crypto";
import {
  ArtifactFileListResponse,
  ArtifactRetention,
  PublishResult,
  PublishResultV2,
  RevisionReadGrant,
  StorageUsage,
} from "@agent-paste/contracts";
import { type Repository, RepositoryError } from "@agent-paste/db";
import { type RevisionFileMapV1, readWorkspaceBlobBytes } from "@agent-paste/storage";
import {
  testArtifactBytesEncryptionEnv,
  testArtifactBytesKeyRing,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { contentCapabilityObjectKey, parseContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { describe, expect, it, vi } from "vitest";
import { handleRequest as handleContentRequest } from "../../content/src/index.js";
import { signAgentViewContentUrls, signPublishResult } from "./agent-view.js";
import type { Env } from "./env.js";
import { fileMapStore } from "./file-map-store.js";
import { handleRequest } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const revisionId = "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const capabilityId = "00112233445566778899aabbccddeeff";
const fileMap = { sha256: "a".repeat(64), size_bytes: 200 };
const future = "2030-01-01T00:00:00.000Z";
const actor = { type: "api_key" as const, id: "key_1", workspace_id: workspaceId, scopes: ["read", "publish"] };

function fixture(overrides: Partial<Repository> = {}) {
  const objects = new Map<string, { body: string | Uint8Array; customMetadata?: Record<string, string> }>();
  const writes = vi.fn();
  let failWrite = false;
  const db = {
    async getWhoami() {
      return {};
    },
    async getWebArtifact() {
      throw new Error("getWebArtifact_not_stubbed");
    },
    ...overrides,
  } as unknown as Repository;
  const env: Env = {
    DB: db,
    AGENT_PASTE_ENV: "dev",
    CONTENT_BASE_URL: "https://content.test",
    CONTENT_CAPABILITY_DOMAIN: "content.test",
    CONTENT_SIGNING_SECRET: "secret",
    ...testArtifactBytesEncryptionEnv,
    AUTH: {
      async verifyApiKey() {
        return actor;
      },
    },
    ACTOR_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    WORKSPACE_BURST_CAP: {
      async limit() {
        return { success: true };
      },
    },
    ARTIFACTS: {
      async get(key) {
        const o = objects.get(key);
        return o
          ? {
              ...o,
              size: typeof o.body === "string" ? new TextEncoder().encode(o.body).length : o.body.length,
              etag: "etag",
            }
          : null;
      },
      async head(key) {
        return objects.has(key) ? {} : null;
      },
      async put(key, value, options) {
        if (failWrite) throw new Error("R2 unavailable");
        writes(key, value);
        objects.set(key, { body: value, customMetadata: options?.customMetadata });
        return { etag: "etag" };
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {},
    },
  };
  async function request(path: string, method = "GET", body?: unknown, scopes = ["read", "publish"]) {
    const reqEnv = {
      ...env,
      AUTH: {
        async verifyApiKey() {
          return { ...actor, scopes };
        },
      },
    };
    return handleRequest(
      new Request(`https://api.test${path}`, {
        method,
        headers: { authorization: "Bearer test", "idempotency-key": "idem_123", "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      reqEnv,
    );
  }
  return {
    env,
    db,
    request,
    objects,
    writes,
    failWrites(value: boolean) {
      failWrite = value;
    },
  };
}

function publishData() {
  return {
    artifact_id: artifactId,
    revision_id: revisionId,
    capability_id: capabilityId,
    title: "Site",
    revision_number: 1,
    pinned_at: null as string | null,
    artifact_updated_at: "2026-11-02T00:00:00.000Z",
    expires_at: future,
    revision_content_url: `https://content.test/v/old/index.html`,
    file_map: fileMap,
    no_change: false,
    changes: { added: 1, changed: 0, removed: 0 },
    bundle: { status: "disabled" },
  };
}
function capabilityView(pinned: boolean, updatedAt: string) {
  return {
    ...publishData(),
    workspace_id: workspaceId,
    entrypoint: "index.html",
    pinned_at: pinned ? updatedAt : null,
    artifact_updated_at: updatedAt,
    files: [{ path: "index.html", size_bytes: 5, content_type: "text/html" }],
  };
}
function tokenFromUrl(url: string) {
  return new URL(url).pathname.split("/")[2];
}

describe("persistent hosting API", () => {
  it("preserves strict legacy publish output and opts into retention fields", async () => {
    const f = fixture();
    const data = { ...publishData(), pinned_at: "2026-11-02T00:00:00.000Z" };
    const legacy = await signPublishResult(data, f.env, { workspaceId });
    expect(PublishResult.safeParse(legacy).success).toBe(true);
    const rich = await signPublishResult(data, f.env, { workspaceId, includeRetention: true });
    expect(PublishResultV2.parse(rich)).toMatchObject({
      retention: "pinned",
      effective_expires_at: null,
      no_change: false,
    });
    const manifest = parseContentCapabilityManifest(
      String(f.objects.get(contentCapabilityObjectKey(capabilityId))?.body),
    );
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "secret");
    expect(payload).toMatchObject({ file_map: fileMap, exp: null });
    expect(payload?.object_keys).toBeUndefined();
  });
  it("signs map URLs for all view files and bounds the preview to 100 with the entrypoint first", async () => {
    const f = fixture();
    const view = {
      ...capabilityView(true, "2026-11-02T00:00:00.000Z"),
      files: Array.from({ length: 150 }, (_, i) => ({
        path: i === 149 ? "index.html" : `${i}.png`,
        object_key: "private",
        url: "old",
      })),
    };
    const signed = (await signAgentViewContentUrls(view, f.env, { workspaceId })) as {
      files: Array<{ path: string; url: string }>;
      file_count: number;
      files_truncated: boolean;
      effective_expires_at: unknown;
      file_map?: unknown;
    };
    expect(signed.files).toHaveLength(100);
    expect(signed.files[0].path).toBe("index.html");
    expect(signed).toMatchObject({ file_count: 150, files_truncated: true, effective_expires_at: null });
    expect(signed.file_map).toBeUndefined();
    for (const file of signed.files)
      expect(await verifyContentToken(tokenFromUrl(file.url), "secret")).toMatchObject({ file_map: fileMap });
  });
  it("preserves full legacy authorization when the agent preview is truncated", async () => {
    const f = fixture();
    const view = {
      ...capabilityView(false, "2026-11-02T00:00:00.000Z"),
      file_map: undefined,
      files: Array.from({ length: 150 }, (_, i) => ({
        path: i === 149 ? "index.html" : `${i}.png`,
        object_key: `workspaces/${workspaceId}/blobs/sha256/aa/${"a".repeat(64)}`,
      })),
    };
    const signed = (await signAgentViewContentUrls(view, f.env, {
      workspaceId,
      refreshCapabilityManifest: true,
    })) as { files: Array<{ path: string }>; revision_content_url: string };
    expect(signed.files).toHaveLength(100);
    const manifest = parseContentCapabilityManifest(
      String(f.objects.get(contentCapabilityObjectKey(capabilityId))?.body),
    );
    for (const token of [tokenFromUrl(signed.revision_content_url), manifest?.signed_token ?? ""]) {
      const payload = await verifyContentToken(token, "secret");
      expect(payload?.paths).toHaveLength(150);
      expect(Object.keys(payload?.object_keys ?? {})).toHaveLength(150);
      for (const file of view.files) expect(payload?.object_keys?.[file.path]).toBe(file.object_key);
    }
  });
  it("mounts paged listing, read grants, and usage with validated queries", async () => {
    const listing = {
      artifact_id: artifactId,
      revision_id: revisionId,
      file_count: 1,
      size_bytes: 5,
      entrypoint: "index.html",
      title: "Site",
      items: [
        {
          path: "index.html",
          sha256: "b".repeat(64),
          size_bytes: 5,
          content_type: "text/html",
          format: "single" as const,
        },
      ],
      page_info: { has_more: false, next_cursor: null },
    };
    const usage = {
      budget_bytes: 100,
      used_bytes: 5,
      reserved_bytes: 0,
      breakdown: { blob_bytes: 5, legacy_file_bytes: 0, bundle_bytes: 0, file_entry_bytes: 0 },
      pins: { pinned_count: 0, pin_allowance: 1 },
    };
    const list = vi.fn(async () => listing);
    const f = fixture({
      listArtifactFiles: list,
      async getRevisionReadTarget() {
        return {
          artifactId,
          revisionId,
          workspaceId,
          fileMap,
          objectKeys: null,
          fileCount: 1,
          sizeBytes: 5,
          ephemeralTier: false,
        };
      },
      async getStorageUsage() {
        return usage;
      },
    });
    const response = await f.request(
      `/v1/artifacts/${artifactId}/files?limit=1000&prefix=docs&revision_id=${revisionId}`,
    );
    expect(response.status).toBe(200);
    expect(ArtifactFileListResponse.safeParse(await response.json()).success).toBe(true);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000, prefix: "docs", revisionId }));
    for (const query of ["limit=1001", "limit=0", "prefix=../escape", "revision_id=bad"])
      expect((await f.request(`/v1/artifacts/${artifactId}/files?${query}`)).status).toBe(400);
    const grantResponse = await f.request(`/v1/artifacts/${artifactId}/read-grant`);
    expect(grantResponse.status).toBe(200);
    const grant = RevisionReadGrant.parse(await grantResponse.json());
    const payload = await verifyContentToken(tokenFromUrl(grant.content_base_url), "secret");
    expect(payload).toMatchObject({ file_map: fileMap, workspace_id: workspaceId, revision_id: revisionId });
    expect(payload?.exp).toBe(Math.floor(Date.parse(grant.expires_at) / 1000));
    expect(Date.parse(grant.expires_at) - Date.now()).toBeGreaterThan(3598_000);
    expect(Date.parse(grant.expires_at) - Date.now()).toBeLessThanOrEqual(3600_000);
    expect(StorageUsage.safeParse(await (await f.request("/v1/usage")).json()).success).toBe(true);
    expect((await f.request(`/v1/artifacts/${artifactId}/read-grant`, "GET", undefined, ["publish"])).status).toBe(403);
  });
  it("refreshes pin/unpin manifests and recovers an R2 failure with an idempotent retry", async () => {
    let pinned = false;
    let update = "2026-11-02T00:00:00.000Z";
    const command = vi.fn(async (input: Parameters<Repository["setArtifactRetention"]>[0]) => {
      pinned = input.pinned;
      update = pinned ? "2026-11-02T00:01:00.000Z" : "2026-11-02T00:02:00.000Z";
      return {
        artifact_id: artifactId,
        workspace_id: workspaceId,
        capability_id: capabilityId,
        retention: pinned ? ("pinned" as const) : ("temporary" as const),
        pinned_at: pinned ? update : null,
        expires_at: future,
        effective_expires_at: pinned ? null : future,
        updated_at: update,
        pinned_count: Number(pinned),
        pin_allowance: 10,
      };
    });
    const f = fixture({
      setArtifactRetention: command,
      async getWebArtifact() {
        return { capability_view: capabilityView(pinned, update) } as never;
      },
    });
    f.failWrites(true);
    const failure = await f.request(`/v1/artifacts/${artifactId}/pin`, "POST", {});
    expect(failure.status).toBe(503);
    f.failWrites(false);
    const pin = await f.request(`/v1/artifacts/${artifactId}/pin`, "POST", {});
    expect(pin.status).toBe(200);
    expect(ArtifactRetention.parse(await pin.json()).effective_expires_at).toBeNull();
    const pinnedManifest = parseContentCapabilityManifest(
      String(f.objects.get(contentCapabilityObjectKey(capabilityId))?.body),
    );
    expect((await verifyContentToken(pinnedManifest?.signed_token ?? "", "secret"))?.exp).toBeNull();
    const unpin = await f.request(`/v1/artifacts/${artifactId}/unpin`, "POST", {});
    expect(unpin.status).toBe(200);
    expect(ArtifactRetention.parse(await unpin.json()).effective_expires_at).toBe(future);
    const unpinnedManifest = parseContentCapabilityManifest(
      String(f.objects.get(contentCapabilityObjectKey(capabilityId))?.body),
    );
    expect((await verifyContentToken(unpinnedManifest?.signed_token ?? "", "secret"))?.exp).toBe(
      Date.parse(future) / 1000,
    );
    expect(command.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual(["idem_123", "idem_123", "idem_123"]);
    expect((await f.request(`/v1/artifacts/${artifactId}/pin`, "POST", {}, ["read"])).status).toBe(403);
  });
  it("returns conflict/quota details and skips fanout for no-change publish", async () => {
    const publish = vi.fn(async () => ({ ...publishData(), no_change: true }));
    const queue = vi.fn();
    const f = fixture({ publishRevision: publish });
    f.env.BUNDLE_GENERATE_QUEUE = { send: queue };
    f.env.SAFETY_SCAN_QUEUE = { send: queue };
    const response = await f.request(`/v1/artifacts/${artifactId}/revisions/${revisionId}/publish`, "POST", {
      include_retention: true,
    });
    expect(response.status).toBe(200);
    expect(PublishResultV2.parse(await response.json()).no_change).toBe(true);
    expect(queue).not.toHaveBeenCalled();
    const details = { kind: "paths", head_revision_id: revisionId, conflicts: [] };
    publish.mockImplementationOnce(async () => {
      throw new RepositoryError("commit_conflict", { details });
    });
    const conflict = await f.request(`/v1/artifacts/${artifactId}/revisions/${revisionId}/publish`, "POST", {});
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "commit_conflict", details } });
    publish.mockImplementationOnce(async () => {
      throw new RepositoryError("storage_quota_exceeded", { details: { budget_bytes: 1 } });
    });
    const quota = await f.request(`/v1/artifacts/${artifactId}/revisions/${revisionId}/publish`, "POST", {});
    expect(quota.status).toBe(429);
    expect(quota.headers.has("retry-after")).toBe(false);
  });
  it("serves a read grant as exact original HTML bytes with hash, attachment, and range resume", async () => {
    const html = new TextEncoder().encode("<!doctype html><html><head></head><body>café</body></html>");
    const sha256 = createHash("sha256").update(html).digest("hex");
    let mapRef = fileMap;
    const f = fixture({
      async getRevisionReadTarget() {
        return {
          artifactId,
          revisionId,
          workspaceId,
          fileMap: mapRef,
          objectKeys: null,
          fileCount: 1,
          sizeBytes: html.length,
          ephemeralTier: true,
        };
      },
    });
    const { writeWorkspaceBlob } = await import("@agent-paste/storage");
    const key = await writeWorkspaceBlob({
      r2: f.env.ARTIFACTS as never,
      workspaceId,
      sha256,
      plaintext: html,
      ring: testArtifactBytesKeyRing(),
    });
    mapRef = await fileMapStore(f.env).write({
      version: 1,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      entrypoint: "index.html",
      files: [
        {
          path: "index.html",
          format: "single",
          content_type: "text/html",
          sha256,
          size_bytes: html.length,
          object_key: key.key,
        },
      ],
    });
    const grant = RevisionReadGrant.parse(await (await f.request(`/v1/artifacts/${artifactId}/read-grant`)).json());
    const token = await verifyContentToken(tokenFromUrl(grant.content_base_url), "secret");
    expect(token?.original_bytes).toBe(true);
    const contentEnv = {
      ...testArtifactBytesEncryptionEnv,
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          return { success: true };
        },
      },
      ARTIFACTS: {
        async get(key: string) {
          const object = f.objects.get(key);
          return object
            ? {
                body: new Blob([object.body as BlobPart]).stream(),
                size: typeof object.body === "string" ? object.body.length : object.body.length,
                customMetadata: object.customMetadata,
              }
            : null;
        },
      },
    };
    const url = `${grant.content_base_url}index.html`;
    const response = await handleContentRequest(
      new Request(url, { headers: { "accept-encoding": "gzip", range: "malformed" } }),
      contentEnv,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="index.html"');
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.has("content-encoding")).toBe(false);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(html);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    const resumed = await handleContentRequest(
      new Request(url, { headers: { range: "bytes=12-", "if-range": response.headers.get("etag") as string } }),
      contentEnv,
    );
    expect(resumed.status).toBe(206);
    expect(new Uint8Array(await resumed.arrayBuffer())).toEqual(html.subarray(12));
  });
  it("stores immutable encrypted file maps through the workspace blob writer", async () => {
    const f = fixture();
    const map: RevisionFileMapV1 = {
      version: 1,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      entrypoint: "index.txt",
      files: [
        {
          path: "index.txt",
          format: "single",
          content_type: "text/plain",
          sha256: "b".repeat(64),
          size_bytes: 5,
          object_key: `workspaces/${workspaceId}/blobs/sha256/bb/${"b".repeat(64)}`,
        },
      ],
    };
    const first = await fileMapStore(f.env).write(map);
    const second = await fileMapStore(f.env).write(map);
    expect(second).toEqual(first);
    expect(f.writes).toHaveBeenCalledTimes(1);
    const bytes = await readWorkspaceBlobBytes({
      r2: f.env.ARTIFACTS as never,
      ring: testArtifactBytesKeyRing(),
      workspaceId,
      sha256: first.sha256,
      expectedPlaintextBytes: first.size_bytes,
    });
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(first.sha256);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(map);
  });
});
