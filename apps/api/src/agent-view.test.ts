import { USAGE_POLICY } from "@agent-paste/config";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entrypointPathFromViewUrl, signAgentViewContentUrls } from "./agent-view.js";
import type { Env } from "./env.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const signingEnv: Env = {
  CONTENT_SIGNING_SECRET: "content-secret",
  CONTENT_BASE_URL: "https://content.test",
};

function contentTokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("/v/")[1]?.split("/")[0] ?? "");
}

function bundleTokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("/b/")[1]?.split("?")[0] ?? "");
}

describe("entrypointPathFromViewUrl", () => {
  it("decodes valid entrypoint paths from view URLs", () => {
    expect(entrypointPathFromViewUrl("https://content.test/v/art.rev/nested%2Findex.html")).toBe("nested/index.html");
  });

  it("keeps malformed encoded entrypoint paths from throwing", () => {
    expect(entrypointPathFromViewUrl("https://content.test/v/art.rev/%E0%A4%A")).toBe("%E0%A4%A");
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

  it("returns unsigned public fields when no content signing secret is configured", async () => {
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      files: [{ path: "index.html", url: "https://content.test/old" }],
      bundle: { status: "ready", url: "https://content.test/b/old" },
    };

    const signed = await signAgentViewContentUrls(view, {}, { workspaceId });

    expect(signed).toEqual({
      artifact_id: "art_1",
      revision_id: "rev_1",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      files: [{ path: "index.html", url: "https://content.test/old" }],
      bundle: { status: "ready", url: "https://content.test/b/old" },
    });
  });

  it("returns unsigned public fields when artifact_id or revision_id is missing", async () => {
    const view = {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      view_url: "https://content.test/old",
      files: [{ path: "index.html", url: "https://content.test/old" }],
    };

    const signed = await signAgentViewContentUrls(view, signingEnv, { workspaceId });

    expect(signed).toEqual({
      artifact_id: "art_1",
      view_url: "https://content.test/old",
      files: [{ path: "index.html", url: "https://content.test/old" }],
    });
  });

  it("signs the entrypoint view_url and file URLs with access-link auth metadata", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "nested/index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        files: [
          { path: "nested/index.html", url: "old" },
          { path: 123, url: "kept" },
        ],
        bundle: { status: "ready", url: "old-bundle" },
      },
      signingEnv,
      { workspaceId, accessLinkId: "al_1" },
    )) as { view_url: string; files: Array<{ url: string }>; bundle: { url: string } };

    expect(signed.view_url).toContain("https://content.test/v/");
    expect(signed.view_url).toContain("/nested/index.html");
    expect(signed.files[0]?.url).toContain("https://content.test/v/");
    expect(signed.files[0]?.url).toContain("/nested/index.html");
    expect(signed.files[1]?.url).toBe("kept");
    expect(signed.bundle.url).toContain("https://content.test/b/");

    const viewPayload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
    expect(viewPayload).toMatchObject({
      artifact_id: "art_1",
      revision_id: "rev_1",
      workspace_id: workspaceId,
      access_link_id: "al_1",
      paths: ["nested/index.html"],
      exp: Math.floor(new Date("2030-01-01T00:00:00.000Z").getTime() / 1000),
    });

    const filePayload = await verifyContentToken(contentTokenFromUrl(signed.files[0]?.url ?? ""), "content-secret");
    expect(filePayload?.paths).toEqual(["nested/index.html"]);

    const bundlePayload = await verifyContentToken(bundleTokenFromUrl(signed.bundle.url), "content-secret");
    expect(bundlePayload).toMatchObject({
      artifact_id: "art_1",
      revision_id: "rev_1",
      workspace_id: workspaceId,
      access_link_id: "al_1",
      key_prefix: expect.stringContaining("art_1"),
    });
  });

  it("passes through view_url when no entrypoint is present", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        view_url: "https://content.test/existing",
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId },
    )) as { view_url: string };

    expect(signed.view_url).toBe("https://content.test/existing");
  });

  it("omits view_url when there is no entrypoint and the stored view_url is not a string", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        view_url: 123,
        files: [{ path: "index.html", url: "old" }],
      },
      signingEnv,
      { workspaceId },
    )) as { view_url?: string };

    expect(signed.view_url).toBeUndefined();
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
    expect(payload?.noindex).toBe(true);
    expect(payload?.script_disabled).toBe(true);
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
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
    )) as { view_url: string };

    const payload = await verifyContentToken(contentTokenFromUrl(signed.view_url), "content-secret");
    expect(payload?.exp).toBe(Math.floor(Date.now() / 1000) + USAGE_POLICY.default_ttl_seconds);
  });
});
