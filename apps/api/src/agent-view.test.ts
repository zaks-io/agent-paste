import { USAGE_POLICY } from "@agent-paste/config";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entrypointPathFromContentUrl, signAgentViewContentUrls, signPublishResult } from "./agent-view.js";
import type { Env } from "./env.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const signingEnv: Env = {
  CONTENT_SIGNING_SECRET: "content-secret",
  CONTENT_BASE_URL: "https://content.test",
};
const sha256 = "a".repeat(64);

function workspaceBlobKey(workspaceId: string, digest: string): string {
  return `workspaces/${workspaceId}/blobs/sha256/${digest.slice(0, 2)}/${digest}`;
}

function contentTokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("/v/")[1]?.split("/")[0] ?? "");
}

function bundleTokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("/b/")[1]?.split("?")[0] ?? "");
}

describe("entrypointPathFromContentUrl", () => {
  it("decodes valid entrypoint paths from content URLs", () => {
    expect(entrypointPathFromContentUrl("https://content.test/v/art.rev/nested%2Findex.html")).toBe(
      "nested/index.html",
    );
  });

  it("ignores query strings and fragments when extracting entrypoint paths", () => {
    expect(entrypointPathFromContentUrl("https://content.test/v/art.rev/nested%2Findex.html?download=1#section")).toBe(
      "nested/index.html",
    );
  });

  it("accepts relative entrypoint paths from stored content metadata", () => {
    expect(entrypointPathFromContentUrl("docs/read%20me.md?download=1#section")).toBe("docs/read me.md");
  });

  it("keeps malformed encoded entrypoint paths from throwing", () => {
    expect(entrypointPathFromContentUrl("https://content.test/v/art.rev/%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("signAgentViewContentUrls characterization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns non-object views unchanged", async () => {
    await expect(signAgentViewContentUrls(null, {})).resolves.toBeNull();
    await expect(signAgentViewContentUrls(undefined, {})).resolves.toBeUndefined();
    await expect(signAgentViewContentUrls("view", {})).resolves.toBe("view");
    await expect(signAgentViewContentUrls(42, {})).resolves.toBe(42);
  });

  it("emits the member private_url only when the authenticated member route opts in", async () => {
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      entrypoint: "index.html",
    };

    const member = (await signAgentViewContentUrls(view, signingEnv, {
      workspaceId,
      includePrivateUrl: true,
    })) as { private_url?: string };
    expect(member.private_url).toContain("/v/art_1");

    // The access-link/public path passes a workspaceId for content signing but its viewer is
    // anonymous; private_url must stay off the wire there.
    const accessLink = (await signAgentViewContentUrls(view, signingEnv, {
      workspaceId,
      accessLinkId: "al_1",
    })) as { private_url?: string };
    expect(accessLink.private_url).toBeUndefined();

    const publicView = (await signAgentViewContentUrls(view, signingEnv)) as { private_url?: string };
    expect(publicView.private_url).toBeUndefined();
  });

  it("strips workspace_id from the public response", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
      },
      signingEnv,
      { workspaceId },
    )) as { workspace_id?: string };

    expect(signed.workspace_id).toBeUndefined();
  });

  it("strips render_mode from the public response", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        render_mode: "markdown",
      },
      signingEnv,
      { workspaceId },
    )) as { render_mode?: string };

    expect(signed.render_mode).toBeUndefined();
  });

  it("returns unsigned public fields when no content signing secret is configured", async () => {
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
      files: [{ path: "index.html", url: "https://content.test/old" }],
      bundle: { status: "ready", url: "https://content.test/b/old" },
    };

    const signed = await signAgentViewContentUrls(view, {}, { workspaceId });

    expect(signed).toEqual({
      artifact_id: "art_1",
      revision_id: "rev_1",
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
      files: [{ path: "index.html", url: "https://content.test/old" }],
      bundle: { status: "ready", url: "https://content.test/b/old" },
    });
  });

  it("returns unsigned public fields when artifact_id or revision_id is missing", async () => {
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_content_url: "https://content.test/old",
      files: [{ path: "index.html", url: "https://content.test/old" }],
    };

    const signed = await signAgentViewContentUrls(view, signingEnv, { workspaceId });

    expect(signed).toEqual({
      artifact_id: "art_1",
      revision_content_url: "https://content.test/old",
      files: [{ path: "index.html", url: "https://content.test/old" }],
    });
  });

  it("strips internal object keys from public files while signing them into content tokens", async () => {
    const objectKey = workspaceBlobKey(workspaceId, sha256);
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        files: [{ path: "index.html", url: "old", object_key: objectKey }],
      },
      signingEnv,
      { workspaceId },
    )) as { files: Array<{ url: string; object_key?: string }> };

    expect(signed.files[0]?.object_key).toBeUndefined();
    const payload = await verifyContentToken(contentTokenFromUrl(signed.files[0]?.url ?? ""), "content-secret");
    expect(payload?.object_key).toBe(objectKey);
  });

  it("signs the entrypoint revision_content_url and file URLs with access-link auth metadata", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "nested/index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [
          { path: "nested/index.html", url: "old" },
          { path: "nested/test-image.png", url: "old-image" },
          { path: 123, url: "kept" },
        ],
        bundle: { status: "ready", url: "old-bundle" },
      },
      signingEnv,
      { workspaceId, accessLinkId: "al_1" },
    )) as { revision_content_url: string; files: Array<{ url: string }>; bundle: { url: string } };

    expect(signed.revision_content_url).toContain("https://content.test/v/");
    expect(signed.revision_content_url).toContain("/nested/index.html");
    expect(signed.files[0]?.url).toContain("https://content.test/v/");
    expect(signed.files[0]?.url).toContain("/nested/index.html");
    expect(signed.files[1]?.url).toContain("https://content.test/v/");
    expect(signed.files[1]?.url).toContain("/nested/test-image.png");
    expect(signed.files[2]?.url).toBe("kept");
    expect(signed.bundle.url).toContain("https://content.test/b/");

    const viewPayload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(viewPayload).toMatchObject({
      artifact_id: "art_1",
      revision_id: "rev_1",
      workspace_id: workspaceId,
      access_link_id: "al_1",
      paths: ["nested/index.html", "nested/test-image.png"],
      exp: Math.floor(new Date("2030-01-01T00:00:00.000Z").getTime() / 1000),
    });

    const filePayload = await verifyContentToken(contentTokenFromUrl(signed.files[0]?.url ?? ""), "content-secret");
    expect(filePayload?.paths).toEqual(["nested/index.html"]);

    const imagePayload = await verifyContentToken(contentTokenFromUrl(signed.files[1]?.url ?? ""), "content-secret");
    expect(imagePayload?.paths).toEqual(["nested/test-image.png"]);

    const bundlePayload = await verifyContentToken(bundleTokenFromUrl(signed.bundle.url), "content-secret");
    expect(bundlePayload).toMatchObject({
      artifact_id: "art_1",
      revision_id: "rev_1",
      workspace_id: workspaceId,
      access_link_id: "al_1",
      key_prefix: expect.stringContaining("art_1"),
    });
  });

  it("re-signs stored revision_content_url when no entrypoint is present", async () => {
    const storedUrl = "https://content.test/v/old.token/docs%2Findex.html?download=1#section";
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        revision_content_url: storedUrl,
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId, accessLinkId: "al_1" },
    )) as { revision_content_url: string };

    expect(signed.revision_content_url).not.toBe(storedUrl);
    expect(signed.revision_content_url).toContain("https://content.test/v/");
    expect(signed.revision_content_url).toContain("/docs/index.html");

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload).toMatchObject({
      artifact_id: "art_1",
      revision_id: "rev_1",
      workspace_id: workspaceId,
      access_link_id: "al_1",
      paths: ["docs/index.html", "index.html"],
      script_disabled: false,
    });
  });

  it("omits revision_content_url when there is no entrypoint and the stored revision_content_url is not a string", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        revision_content_url: 123,
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url?: string };

    expect(signed.revision_content_url).toBeUndefined();
  });

  it("passes through non-array files unchanged", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        files: "not-an-array",
      },
      signingEnv,
      { workspaceId },
    )) as { files: unknown };

    expect(signed.files).toBe("not-an-array");
  });

  it("leaves non-ready bundles unchanged", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        bundle: { status: "building", url: "old-bundle" },
      },
      signingEnv,
      { workspaceId },
    )) as { bundle: { status: string; url: string } };

    expect(signed.bundle).toEqual({ status: "building", url: "old-bundle" });
  });

  it("returns an undefined bundle URL when no workspace id is available for signing", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        bundle: { status: "ready", url: "old-bundle" },
      },
      signingEnv,
    )) as { bundle: { url?: string } };

    expect(signed.bundle.url).toBeUndefined();
  });

  it("sets noindex and script_disabled on signed content URLs when the agent view is ephemeral tier via options", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId, ephemeralTier: true },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.noindex).toBe(true);
    expect(payload?.script_disabled).toBe(true);
  });

  it("omits path scoping on publish-result entrypoint URLs so relative assets can load", async () => {
    const signed = (await signPublishResult(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Artifact",
        render_mode: "markdown",
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
        agent_view_url: "https://api.test/v1/public/agent-view/art_1.rev_1",
        expires_at: "2030-01-01T00:00:00.000Z",
        bundle: { status: "disabled" },
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url: string; render_mode?: string };

    expect(signed.render_mode).toBeUndefined();
    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.paths).toBeUndefined();
    expect(payload?.script_disabled).toBe(false);
  });

  it("scopes publish-result entrypoint URLs when signing an explicit object key", async () => {
    const objectKey = workspaceBlobKey(workspaceId, sha256);
    const signed = (await signPublishResult(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Artifact",
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
        agent_view_url: "https://api.test/v1/public/agent-view/art_1.rev_1",
        entrypoint_object_key: objectKey,
        expires_at: "2030-01-01T00:00:00.000Z",
        bundle: { status: "disabled" },
      },
      signingEnv,
      { workspaceId },
    )) as { entrypoint_object_key?: string; revision_content_url: string };

    expect(signed.entrypoint_object_key).toBeUndefined();
    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.object_key).toBe(objectKey);
    expect(payload?.paths).toEqual(["index.html"]);
  });

  it("signs publish-result revision URLs with per-path object keys", async () => {
    const indexKey = workspaceBlobKey(workspaceId, sha256);
    const assetKey = workspaceBlobKey(workspaceId, "b".repeat(64));
    const signed = (await signPublishResult(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Artifact",
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
        agent_view_url: "https://api.test/v1/public/agent-view/art_1.rev_1",
        entrypoint_object_key: indexKey,
        file_object_keys: {
          "index.html": indexKey,
          "assets/app.js": assetKey,
        },
        expires_at: "2030-01-01T00:00:00.000Z",
        bundle: { status: "disabled" },
      },
      signingEnv,
      { workspaceId },
    )) as { entrypoint_object_key?: string; file_object_keys?: unknown; revision_content_url: string };

    expect(signed.entrypoint_object_key).toBeUndefined();
    expect(signed.file_object_keys).toBeUndefined();
    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.object_key).toBeUndefined();
    expect(payload?.object_keys).toEqual({
      "index.html": indexKey,
      "assets/app.js": assetKey,
    });
    expect(payload?.paths).toEqual(["index.html", "assets/app.js"]);
  });

  it("sets noindex and script_disabled when ephemeral_tier is present on the view payload", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        ephemeral_tier: true,
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.noindex).toBe(true);
    expect(payload?.script_disabled).toBe(true);
  });

  it("sets script_disabled false on signed content URLs for claimed tenants", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.script_disabled).toBe(false);
    expect(payload?.noindex).toBeUndefined();
  });

  it("omits script_disabled when no workspace id is available for signing", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      signingEnv,
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.script_disabled).toBeUndefined();
    expect(payload?.workspace_id).toBeUndefined();
  });

  it("prefers options.workspaceId over the internal workspace_id field", async () => {
    const overrideWorkspaceId = "00000000-0000-4000-8000-000000000099";
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      signingEnv,
      { workspaceId: overrideWorkspaceId },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.workspace_id).toBe(overrideWorkspaceId);
  });

  it("uses the internal workspace_id when options.workspaceId is omitted", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
      signingEnv,
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.workspace_id).toBe(workspaceId);
  });

  it("falls back to the default TTL when expires_at is missing or invalid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00.000Z"));

    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "not-a-date",
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.exp).toBe(Math.floor(Date.now() / 1000) + USAGE_POLICY.default_ttl_seconds);
  });

  it("falls back to the default TTL when expires_at is already in the past (pinned artifacts)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00.000Z"));

    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2025-01-01T00:00:00.000Z",
      },
      signingEnv,
      { workspaceId },
    )) as { revision_content_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.revision_content_url), "content-secret");
    expect(payload?.exp).toBe(Math.floor(Date.now() / 1000) + USAGE_POLICY.default_ttl_seconds);
  });
});
