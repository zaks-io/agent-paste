import { verifyContentToken } from "@agent-paste/tokens/content";
import { contentCapabilityObjectKey, parseContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { describe, expect, it } from "vitest";
import { signAgentViewContentUrls, signPublishResult } from "./agent-view.js";
import type { Env, R2Bucket } from "./env.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function capabilityEnv(): { env: Env; writes: Map<string, string> } {
  const writes = new Map<string, string>();
  const bucket: R2Bucket = {
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
    async get() {
      return null;
    },
    async put(key, value) {
      writes.set(key, value);
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
  return new URL(url).hostname.split(".")[0] ?? "";
}

describe("agent view capability origins", () => {
  it("stores one Access Link-scoped manifest and gives every file the same origin", async () => {
    const { env, writes } = capabilityEnv();
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [
          { path: "index.html", object_key: "workspaces/ws/blobs/index" },
          { path: "assets/app.js", object_key: "workspaces/ws/blobs/app" },
          { path: "fonts/site.woff2", object_key: "workspaces/ws/blobs/font" },
        ],
      },
      env,
      { workspaceId, accessLinkId: "al_1" },
    )) as { revision_content_url: string; files: Array<{ url: string }> };

    const origin = new URL(signed.revision_content_url).origin;
    expect(signed.files.map((file) => new URL(file.url).origin)).toEqual([origin, origin, origin]);
    expect(new URL("/assets/app.js", signed.revision_content_url).origin).toBe(origin);
    expect(new URL("/fonts/site.woff2", signed.revision_content_url).origin).toBe(origin);
    expect(writes.size).toBe(1);

    const capabilityId = capabilityIdFromUrl(signed.revision_content_url);
    const manifest = parseContentCapabilityManifest(writes.get(contentCapabilityObjectKey(capabilityId)) ?? "");
    expect(manifest?.entrypoint).toBe("index.html");
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(payload).toMatchObject({
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      access_link_id: "al_1",
      paths: ["index.html", "assets/app.js", "fonts/site.woff2"],
      script_disabled: false,
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
        revision_id: "rev_1",
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

  it("mints distinct capabilities for two Access Links to the same Revision", async () => {
    const { env, writes } = capabilityEnv();
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      entrypoint: "index.html",
      files: [{ path: "index.html" }],
    };

    const first = (await signAgentViewContentUrls(view, env, {
      workspaceId,
      accessLinkId: "al_1",
    })) as { revision_content_url: string };
    const second = (await signAgentViewContentUrls(view, env, {
      workspaceId,
      accessLinkId: "al_2",
    })) as { revision_content_url: string };

    expect(new URL(first.revision_content_url).origin).not.toBe(new URL(second.revision_content_url).origin);
    const manifests = [...writes.values()].map((value) => parseContentCapabilityManifest(value));
    const payloads = await Promise.all(
      manifests.map((manifest) => verifyContentToken(manifest?.signed_token ?? "", "content-secret")),
    );
    expect(payloads.map((payload) => payload?.access_link_id).sort()).toEqual(["al_1", "al_2"]);
  });

  it("fails loudly when capability hosting is configured without a writable R2 binding", async () => {
    await expect(
      signAgentViewContentUrls(
        { workspace_id: workspaceId, artifact_id: "art_1", revision_id: "rev_1", entrypoint: "index.html" },
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
        { workspace_id: workspaceId, artifact_id: "art_1", revision_id: "rev_1", entrypoint: "index.html" },
        { CONTENT_CAPABILITY_DOMAIN: "content.example.test" },
        { workspaceId },
      ),
    ).rejects.toThrow(/signing secret/);
  });
});
