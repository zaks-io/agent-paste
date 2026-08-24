import { verifyContentToken } from "@agent-paste/tokens/content";
import {
  contentCapabilityIdFromHostname,
  contentCapabilityObjectKey,
  parseContentCapabilityManifest,
} from "@agent-paste/tokens/content-capability";
import { describe, expect, it } from "vitest";
import { signAgentViewContentUrls, signPublishResult } from "./agent-view.js";
import type { Env, R2Bucket } from "./env.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const capabilityId = "00112233445566778899aabbccddeeff";

function capabilityEnv(): { env: Env; writes: Map<string, string> } {
  const writes = new Map<string, string>();
  let etag = 0;
  const bucket: R2Bucket = {
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
    async get(key) {
      const value = writes.get(key);
      return value ? { body: value, etag: String(etag) } : null;
    },
    async put(key, value, options) {
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== String(etag)) return null;
      if (options?.onlyIf?.etagDoesNotMatch === "*" && writes.has(key)) return null;
      writes.set(key, value);
      etag += 1;
      return {};
    },
  };
  return {
    env: {
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_CAPABILITY_DOMAIN: "content.example.test",
      CONTENT_BASE_URL: "https://legacy-content.example.test",
      ARTIFACTS: bucket,
    },
    writes,
  };
}

function capabilityIdFromUrl(url: string): string {
  return contentCapabilityIdFromHostname(new URL(url).hostname, "content.example.test") ?? "";
}

describe("agent view capability origins", () => {
  it("stores one Artifact-scoped manifest and gives every file the same origin", async () => {
    const { env, writes } = capabilityEnv();
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        capability_id: capabilityId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        revision_number: 1,
        artifact_updated_at: "2026-08-24T00:00:00.000Z",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [
          { path: "index.html", object_key: "workspaces/ws/blobs/index" },
          { path: "assets/app.js", object_key: "workspaces/ws/blobs/app" },
          { path: "fonts/site.woff2", object_key: "workspaces/ws/blobs/font" },
        ],
      },
      env,
      { workspaceId },
    )) as { revision_content_url: string; files: Array<{ url: string }> };

    const origin = new URL(signed.revision_content_url).origin;
    expect(new URL(origin).hostname).toBe(`${capabilityId}-uc.content.example.test`);
    expect(signed.files.map((file) => new URL(file.url).origin)).toEqual([origin, origin, origin]);
    expect(new URL("/assets/app.js", signed.revision_content_url).origin).toBe(origin);
    expect(new URL("/fonts/site.woff2", signed.revision_content_url).origin).toBe(origin);
    expect(writes.size).toBe(1);

    const manifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    expect(manifest?.entrypoint).toBe("index.html");
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(payload).toMatchObject({
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      paths: ["index.html", "assets/app.js", "fonts/site.woff2"],
    });
  });

  it("keeps a 100-file publish URL bounded while moving the path map into R2", async () => {
    const { env, writes } = capabilityEnv();
    const fileObjectKeys = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`assets/file-${index}.js`, `workspaces/ws/blobs/${index}`]),
    );
    const signed = (await signPublishResult(
      {
        artifact_id: "art_1",
        capability_id: capabilityId,
        revision_id: "rev_1",
        revision_number: 1,
        artifact_updated_at: "2026-08-24T00:00:00.000Z",
        revision_content_url: "https://legacy-content.example.test/v/old/index.html",
        file_object_keys: { "index.html": "workspaces/ws/blobs/index", ...fileObjectKeys },
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      env,
      { workspaceId },
    )) as { revision_content_url: string };

    expect(signed.revision_content_url.length).toBeLessThan(200);
    expect(signed.revision_content_url).not.toContain("/v/");
    expect(writes.size).toBe(1);
    const manifest = parseContentCapabilityManifest(
      writes.get(contentCapabilityObjectKey(capabilityIdFromUrl(signed.revision_content_url))) ?? "",
    );
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(payload?.paths).toHaveLength(101);
    expect(Object.keys(payload?.object_keys ?? {})).toHaveLength(101);
  });

  it("rewrites the same Artifact capability for a new Revision", async () => {
    const { env, writes } = capabilityEnv();
    const view = {
      workspace_id: workspaceId,
      capability_id: capabilityId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      revision_number: 1,
      artifact_updated_at: "2026-08-24T00:00:00.000Z",
      entrypoint: "index.html",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html" }],
    };

    const first = (await signAgentViewContentUrls(view, env, { workspaceId })) as { revision_content_url: string };
    const second = (await signAgentViewContentUrls(
      {
        ...view,
        revision_id: "rev_2",
        revision_number: 2,
        artifact_updated_at: "2026-08-24T00:01:00.000Z",
      },
      env,
      { workspaceId },
    )) as {
      revision_content_url: string;
    };

    expect(new URL(first.revision_content_url).origin).toBe(new URL(second.revision_content_url).origin);
    expect(writes.size).toBe(1);
    const manifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(payload?.revision_id).toBe("rev_2");
  });

  it("does not let a stale publish replay roll a capability manifest backward", async () => {
    const { env, writes } = capabilityEnv();
    const base = {
      workspace_id: workspaceId,
      capability_id: capabilityId,
      artifact_id: "art_1",
      entrypoint: "index.html",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html" }],
    };
    await signAgentViewContentUrls(
      {
        ...base,
        revision_id: "rev_2",
        revision_number: 2,
        artifact_updated_at: "2026-08-24T00:02:00.000Z",
      },
      env,
      { workspaceId },
    );
    await signAgentViewContentUrls(
      {
        ...base,
        revision_id: "rev_1",
        revision_number: 1,
        artifact_updated_at: "2026-08-24T00:01:00.000Z",
      },
      env,
      { workspaceId },
    );

    const manifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(manifest?.revision_number).toBe(2);
    expect(payload?.revision_id).toBe("rev_2");
  });

  it("retries a conditional manifest conflict against the latest stored state", async () => {
    const { env, writes } = capabilityEnv();
    const bucket = env.ARTIFACTS;
    if (!bucket?.put) throw new Error("test bucket requires put");
    const originalPut = bucket.put.bind(bucket);
    let putAttempts = 0;
    bucket.put = async (key, value, options) => {
      putAttempts += 1;
      if (putAttempts === 1) {
        writes.set(
          key,
          JSON.stringify({
            version: 1,
            signed_token: "competing-token",
            entrypoint: "index.html",
            revision_number: 1,
            artifact_updated_at: "2026-08-24T00:00:00.000Z",
          }),
        );
        return null;
      }
      return originalPut(key, value, options);
    };

    await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        capability_id: capabilityId,
        artifact_id: "art_1",
        revision_id: "rev_2",
        revision_number: 2,
        artifact_updated_at: "2026-08-24T00:01:00.000Z",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [{ path: "index.html" }],
      },
      env,
      { workspaceId },
    );

    expect(putAttempts).toBe(2);
    const manifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    expect(manifest?.revision_number).toBe(2);
  });

  it("fails loudly after repeated conditional manifest conflicts", async () => {
    const { env } = capabilityEnv();
    const bucket = env.ARTIFACTS;
    if (!bucket) throw new Error("test bucket missing");
    let putAttempts = 0;
    bucket.put = async () => {
      putAttempts += 1;
      return null;
    };

    await expect(
      signAgentViewContentUrls(
        {
          workspace_id: workspaceId,
          capability_id: capabilityId,
          artifact_id: "art_1",
          revision_id: "rev_1",
          revision_number: 1,
          artifact_updated_at: "2026-08-24T00:00:00.000Z",
          entrypoint: "index.html",
          expires_at: "2030-01-01T00:00:00.000Z",
          files: [{ path: "index.html" }],
        },
        env,
        { workspaceId },
      ),
    ).rejects.toThrow(/lost repeated conditional write races/);
    expect(putAttempts).toBe(5);
  });

  it("rejects a persisted capability without revision state", async () => {
    const { env } = capabilityEnv();

    await expect(
      signAgentViewContentUrls(
        {
          workspace_id: workspaceId,
          capability_id: capabilityId,
          artifact_id: "art_1",
          revision_id: "rev_1",
          entrypoint: "index.html",
          expires_at: "2030-01-01T00:00:00.000Z",
          files: [{ path: "index.html" }],
        },
        env,
        { workspaceId },
      ),
    ).rejects.toThrow(/persisted capability requires revision state/);
  });

  it("rewrites the same manifest between pinned and expiring lifecycle states", async () => {
    const { env, writes } = capabilityEnv();
    const baseView = {
      workspace_id: workspaceId,
      capability_id: capabilityId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      revision_number: 1,
      artifact_updated_at: "2026-08-24T00:00:00.000Z",
      entrypoint: "index.html",
      bundle: { status: "ready" },
      files: [{ path: "index.html" }],
    };

    const pinned = (await signAgentViewContentUrls({ ...baseView, pinned_at: "2026-08-24T00:00:00.000Z" }, env, {
      workspaceId,
    })) as { revision_content_url: string; bundle: { url: string } };
    const pinnedManifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    const pinnedPayload = await verifyContentToken(pinnedManifest?.signed_token ?? "", "content-secret");
    expect(pinnedPayload?.exp).toBeNull();
    const legacyBundleToken = new URL(pinned.bundle.url).pathname.split("/")[2] ?? "";
    expect((await verifyContentToken(legacyBundleToken, "content-secret"))?.exp).toEqual(expect.any(Number));

    const unpinned = (await signAgentViewContentUrls(
      {
        ...baseView,
        artifact_updated_at: "2026-08-24T00:01:00.000Z",
        expires_at: "2026-01-01T00:00:00.000Z",
      },
      env,
      { workspaceId },
    )) as { revision_content_url: string };
    const unpinnedManifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    const unpinnedPayload = await verifyContentToken(unpinnedManifest?.signed_token ?? "", "content-secret", {
      now: () => new Date("2025-01-01T00:00:00.000Z").getTime(),
    });

    expect(new URL(unpinned.revision_content_url).origin).toBe(new URL(pinned.revision_content_url).origin);
    expect(unpinnedPayload?.exp).toBe(Math.floor(new Date("2026-01-01T00:00:00.000Z").getTime() / 1000));
  });

  it("fails loudly when capability hosting is configured without a writable R2 binding", async () => {
    await expect(
      signAgentViewContentUrls(
        {
          workspace_id: workspaceId,
          capability_id: capabilityId,
          artifact_id: "art_1",
          revision_id: "rev_1",
          revision_number: 1,
          artifact_updated_at: "2026-08-24T00:00:00.000Z",
          entrypoint: "index.html",
          expires_at: "2030-01-01T00:00:00.000Z",
        },
        {
          CONTENT_SIGNING_SECRET: "content-secret",
          CONTENT_CAPABILITY_DOMAIN: "content.example.test",
        },
        { workspaceId },
      ),
    ).rejects.toThrow(/R2 write binding/);
  });

  it("fails loudly when capability hosting is configured without a signing secret", async () => {
    await expect(
      signAgentViewContentUrls(
        {
          workspace_id: workspaceId,
          capability_id: capabilityId,
          artifact_id: "art_1",
          revision_id: "rev_1",
          revision_number: 1,
          artifact_updated_at: "2026-08-24T00:00:00.000Z",
          entrypoint: "index.html",
        },
        { CONTENT_CAPABILITY_DOMAIN: "content.example.test" },
        { workspaceId },
      ),
    ).rejects.toThrow(/signing secret/);
  });
});
