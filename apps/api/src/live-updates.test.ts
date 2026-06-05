import type { Repository } from "@agent-paste/db";
import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { mintContentUrl, verifyContentToken } from "@agent-paste/tokens/content";
import { STREAM_INTERNAL_SECRET_HEADER } from "@agent-paste/worker-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./index.js";
import {
  buildRevisionNoticeFromPublishResult,
  handleLiveUpdateAuthorize,
  notifyLiveUpdateDisconnect,
  notifyLiveUpdateDisconnectWorkspace,
  notifyLiveUpdatePublish,
  wireLiveUpdateDeps,
} from "./live-updates.js";

const pointer = {
  revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  iframe_src: "https://content.test/v/art.rev/index.html",
  render_mode: "html" as const,
  title: "Demo",
};

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const streamSecret = "stream-internal-secret";
const contentSecret = "content-signing-secret";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const accessLinkId = "al_test";

function contentTokenFromViewUrl(viewUrl: string): string {
  const match = viewUrl.match(/\/v\/([^/]+)\//);
  return decodeURIComponent(match?.[1] ?? "");
}

function signingSignAgentView(view: unknown, env: Env, options?: { accessLinkId?: string; workspaceId?: string }) {
  const data = view as {
    artifact_id: string;
    revision_id: string;
    entrypoint: string;
    expires_at?: string;
  };
  const exp = data.expires_at
    ? Math.floor(new Date(data.expires_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 3600;
  return mintContentUrl({
    baseUrl: env.CONTENT_BASE_URL ?? "https://content.test",
    secret: env.CONTENT_SIGNING_SECRET as string,
    payload: {
      artifact_id: data.artifact_id,
      revision_id: data.revision_id,
      workspace_id: options?.workspaceId,
      access_link_id: options?.accessLinkId,
      paths: [data.entrypoint],
      exp,
    },
    path: data.entrypoint,
  }).then((view_url) => ({ ...(view as object), view_url }));
}

function streamAuthorizeRequest(init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set(STREAM_INTERNAL_SECRET_HEADER, streamSecret);
  return new Request("https://api.test/x", { ...init, headers });
}

afterEach(() => {
  wireLiveUpdateDeps({
    signAgentView: async (view) => view,
    authenticateWeb: async () => null,
  });
});

describe("handleLiveUpdateAuthorize", () => {
  it("rejects spoofed caller headers and missing internal secrets", async () => {
    const db = {} as Repository;
    const env = {
      CONTENT_BASE_URL: "https://content.test",
      STREAM_INTERNAL_SECRET: streamSecret,
    } as Env;

    const wrongCaller = await handleLiveUpdateAuthorize(new Request("https://api.test/x"), env, db);
    expect(wrongCaller.status).toBe(404);

    const spoofedHeader = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", { headers: { "x-agent-paste-caller": "stream" } }),
      env,
      db,
    );
    expect(spoofedHeader.status).toBe(404);

    const wrongSecret = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", {
        headers: { [STREAM_INTERNAL_SECRET_HEADER]: "wrong-secret" },
      }),
      env,
      db,
    );
    expect(wrongSecret.status).toBe(404);

    const missingConfiguredSecret = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest(),
      { ...env, STREAM_INTERNAL_SECRET: undefined } as Env,
      db,
    );
    expect(missingConfiguredSecret.status).toBe(404);
  });

  it("rejects malformed bodies from authorized stream callers", async () => {
    const db = {} as Repository;
    const env = {
      CONTENT_BASE_URL: "https://content.test",
      STREAM_INTERNAL_SECRET: streamSecret,
    } as Env;

    const invalidJson = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        body: "not-json",
      }),
      env,
      db,
    );
    expect(invalidJson.status).toBe(400);

    const invalidBody = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "unknown" }),
      }),
      env,
      db,
    );
    expect(invalidBody.status).toBe(400);
  });

  it("authorizes access links, rejects revision links, and rate limits artifact reads", async () => {
    wireLiveUpdateDeps({
      signAgentView: async (view) => ({
        ...(view as object),
        view_url: "https://content.test/v/art.rev/index.html",
      }),
      authenticateWeb: async () => null,
    });
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 1,
      signingSecret: "access-link-secret",
    });
    const env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      CONTENT_BASE_URL: "https://content.test",
      STREAM_INTERNAL_SECRET: streamSecret,
      ARTIFACT_RATE_LIMIT: {
        limit: vi.fn(async () => ({ success: true })),
      },
    } as Env;
    const db = {
      async resolveAccessLink(input: { publicId: string }) {
        if (input.publicId === "0123456789ABCDEF") {
          return {
            access_link_id: "al_test",
            access_link_type: "share",
            workspace_id: "00000000-0000-4000-8000-000000000001",
            render_mode: "html",
            title: "Shared",
            iframe_src: "https://content.test/v/art.rev/index.html",
            agent_view: {
              artifact_id: artifactId,
              revision_id: pointer.revision_id,
              title: "Shared",
              created_at: "2026-01-01T00:00:00.000Z",
              expires_at: "2030-01-01T00:00:00.000Z",
              entrypoint: "index.html",
              view_url: "https://content.test/v/art.rev/index.html",
              files: [],
            },
          };
        }
        return {
          access_link_id: "al_rev",
          access_link_type: "revision",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          render_mode: "html",
          title: "Rev",
          iframe_src: "https://content.test/v/art.rev/index.html",
          agent_view: {
            artifact_id: artifactId,
            revision_id: pointer.revision_id,
            title: "Rev",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2030-01-01T00:00:00.000Z",
            entrypoint: "index.html",
            view_url: "https://content.test/v/art.rev/index.html",
            files: [],
          },
        };
      },
    } as unknown as Repository;

    const ok = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      env,
      db,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ audience: "share", artifact_id: artifactId });
    expect(env.ARTIFACT_RATE_LIMIT?.limit).toHaveBeenCalledWith({ key: artifactId });

    const revisionDenied = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDFG", blob }),
      }),
      { ...env, ACCESS_LINK_SIGNING_KEY_V1: undefined } as Env,
      db,
    );
    expect(revisionDenied.status).toBe(404);

    const rateLimitedEnv = {
      ...env,
      ARTIFACT_RATE_LIMIT: {
        limit: vi.fn(async () => ({ success: false })),
      },
    } as Env;
    const rateLimited = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      rateLimitedEnv,
      db,
    );
    expect(rateLimited.status).toBe(429);
    await expect(rateLimited.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
    expect(rateLimited.headers.get("Retry-After")).toBe("60");
  });

  it("fails closed when access-link authorize artifact rate limiting is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    wireLiveUpdateDeps({
      signAgentView: async (view) => ({
        ...(view as object),
        view_url: "https://content.test/v/art.rev/index.html",
      }),
      authenticateWeb: async () => null,
    });
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 1,
      signingSecret: "access-link-secret",
    });
    const env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      CONTENT_BASE_URL: "https://content.test",
      STREAM_INTERNAL_SECRET: streamSecret,
      ARTIFACT_RATE_LIMIT: {
        limit: vi.fn(async () => {
          throw new Error("rate limit unavailable");
        }),
      },
    } as Env;
    const db = {
      async resolveAccessLink(input: { publicId: string }) {
        if (input.publicId === "0123456789ABCDEF") {
          return {
            access_link_id: "al_test",
            access_link_type: "share",
            workspace_id: "00000000-0000-4000-8000-000000000001",
            render_mode: "html",
            title: "Shared",
            iframe_src: "https://content.test/v/art.rev/index.html",
            agent_view: {
              artifact_id: artifactId,
              revision_id: pointer.revision_id,
              title: "Shared",
              created_at: "2026-01-01T00:00:00.000Z",
              expires_at: "2030-01-01T00:00:00.000Z",
              entrypoint: "index.html",
              view_url: "https://content.test/v/art.rev/index.html",
              files: [],
            },
          };
        }
        return null;
      },
    } as unknown as Repository;

    const throwing = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      env,
      db,
    );
    expect(throwing.status).toBe(429);
    await expect(throwing.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
    expect(warn).toHaveBeenCalledWith(
      "Artifact rate limit binding failed; denying live update authorize.",
      expect.any(Error),
    );

    const missing = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      { ...env, ARTIFACT_RATE_LIMIT: undefined },
      db,
    );
    expect(missing.status).toBe(429);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
    warn.mockRestore();
  });

  it("authorizes dashboard sessions and requires bearer tokens", async () => {
    wireLiveUpdateDeps({
      signAgentView: async (view) => ({
        ...(view as object),
        view_url: "https://content.test/v/art.rev/index.html",
      }),
      authenticateWeb: async (authorization) =>
        authorization === "Bearer member"
          ? { member: { workspace_id: "00000000-0000-4000-8000-000000000001" } as never }
          : null,
    });
    const env = {
      CONTENT_BASE_URL: "https://content.test",
      STREAM_INTERNAL_SECRET: streamSecret,
    } as Env;
    const db = {
      async getAgentView() {
        return {
          artifact_id: artifactId,
          revision_id: pointer.revision_id,
          title: "Dashboard",
          entrypoint: "index.html",
        };
      },
    } as unknown as Repository;

    const missingAuth = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "dashboard", artifact_id: artifactId }),
      }),
      env,
      db,
    );
    expect(missingAuth.status).toBe(404);

    const ok = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer member",
        },
        body: JSON.stringify({ kind: "dashboard", artifact_id: artifactId }),
      }),
      env,
      db,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ audience: "dashboard" });

    wireLiveUpdateDeps({
      signAgentView: async () => ({ view_url: 1 }),
      authenticateWeb: async () => ({ member: { workspace_id: "ws" } as never }),
    });
    const badViewUrl = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer member",
        },
        body: JSON.stringify({ kind: "dashboard", artifact_id: artifactId }),
      }),
      env,
      {
        async getAgentView() {
          return null;
        },
      } as unknown as Repository,
    );
    expect(badViewUrl.status).toBe(404);
  });

  it("scopes dashboard live-update content tokens with workspace_id", async () => {
    wireLiveUpdateDeps({
      signAgentView: signingSignAgentView,
      authenticateWeb: async (authorization) =>
        authorization === "Bearer member" ? { member: { workspace_id: workspaceId } as never } : null,
    });
    const env = {
      CONTENT_BASE_URL: "https://content.test",
      CONTENT_SIGNING_SECRET: contentSecret,
      STREAM_INTERNAL_SECRET: streamSecret,
    } as Env;
    const db = {
      async getAgentView() {
        return {
          artifact_id: artifactId,
          revision_id: pointer.revision_id,
          title: "Dashboard",
          entrypoint: "index.html",
          expires_at: "2030-01-01T00:00:00.000Z",
        };
      },
    } as unknown as Repository;

    const response = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer member",
        },
        body: JSON.stringify({ kind: "dashboard", artifact_id: artifactId }),
      }),
      env,
      db,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pointer: { iframe_src: string } };
    const tokenPayload = await verifyContentToken(contentTokenFromViewUrl(body.pointer.iframe_src), contentSecret);
    expect(tokenPayload?.workspace_id).toBe(workspaceId);
    expect(tokenPayload?.access_link_id).toBeUndefined();
  });

  it("scopes share-link live-update content tokens with workspace_id and access_link_id", async () => {
    wireLiveUpdateDeps({
      signAgentView: signingSignAgentView,
      authenticateWeb: async () => null,
    });
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 1,
      signingSecret: "access-link-secret",
    });
    const env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      CONTENT_BASE_URL: "https://content.test",
      CONTENT_SIGNING_SECRET: contentSecret,
      STREAM_INTERNAL_SECRET: streamSecret,
      ARTIFACT_RATE_LIMIT: {
        limit: vi.fn(async () => ({ success: true })),
      },
    } as Env;
    const db = {
      async resolveAccessLink() {
        return {
          access_link_id: accessLinkId,
          access_link_type: "share",
          workspace_id: workspaceId,
          render_mode: "html",
          title: "Shared",
          iframe_src: "https://content.test/v/art.rev/index.html",
          agent_view: {
            artifact_id: artifactId,
            revision_id: pointer.revision_id,
            title: "Shared",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2030-01-01T00:00:00.000Z",
            entrypoint: "index.html",
            view_url: "https://content.test/v/art.rev/index.html",
            files: [],
          },
        };
      },
    } as unknown as Repository;

    const response = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      env,
      db,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pointer: { iframe_src: string } };
    const tokenPayload = await verifyContentToken(contentTokenFromViewUrl(body.pointer.iframe_src), contentSecret);
    expect(tokenPayload?.workspace_id).toBe(workspaceId);
    expect(tokenPayload?.access_link_id).toBe(accessLinkId);
  });

  it("denies live-update authorize after access link lockdown", async () => {
    wireLiveUpdateDeps({
      signAgentView: signingSignAgentView,
      authenticateWeb: async () => null,
    });
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 1,
      signingSecret: "access-link-secret",
    });
    const env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      CONTENT_BASE_URL: "https://content.test",
      CONTENT_SIGNING_SECRET: contentSecret,
      STREAM_INTERNAL_SECRET: streamSecret,
    } as Env;
    const db = {
      async resolveAccessLink() {
        return null;
      },
    } as unknown as Repository;

    const response = await handleLiveUpdateAuthorize(
      streamAuthorizeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      env,
      db,
    );
    expect(response.status).toBe(404);
  });
});

describe("buildRevisionNoticeFromPublishResult", () => {
  it("returns null for invalid publish payloads", async () => {
    expect(await buildRevisionNoticeFromPublishResult(null, "index.html", "t")).toBeNull();
    expect(await buildRevisionNoticeFromPublishResult({}, "index.html", "t")).toBeNull();
    expect(await buildRevisionNoticeFromPublishResult({ artifact_id: artifactId }, "index.html", "t")).toBeNull();
  });

  it("builds revision notices from signed publish results without content URLs", async () => {
    const built = await buildRevisionNoticeFromPublishResult(
      {
        artifact_id: artifactId,
        revision_id: pointer.revision_id,
        view_url: pointer.iframe_src,
      },
      "index.html",
      pointer.title,
    );
    expect(built).toMatchObject({
      revision_id: pointer.revision_id,
      entrypoint: "index.html",
      render_mode: "html",
      title: pointer.title,
    });
    expect(built).not.toHaveProperty("iframe_src");
  });
});

describe("live update notify helpers", () => {
  it("no-ops when bindings or messages are invalid", async () => {
    await notifyLiveUpdatePublish({} as Env, {
      artifactId: "bad",
      revision: {
        revision_id: pointer.revision_id,
        entrypoint: "index.html",
        render_mode: pointer.render_mode,
        title: pointer.title,
      },
    });
    await notifyLiveUpdateDisconnect({} as Env, {
      artifactId: "bad",
      audiences: ["share"],
      reason: "deletion",
    });
    await notifyLiveUpdateDisconnectWorkspace({} as Env, {} as Repository, {
      workspaceId: "ws",
      audiences: ["share"],
      reason: "deletion",
    });
  });

  it("notifies artifact live stubs and fans out workspace disconnects", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const env = {
      ARTIFACT_LIVE: {
        idFromName: (name: string) => name,
        get: () => ({ fetch }),
      },
    } as never;

    await notifyLiveUpdatePublish(env, {
      artifactId,
      revision: {
        revision_id: pointer.revision_id,
        entrypoint: "index.html",
        render_mode: pointer.render_mode,
        title: pointer.title,
      },
    });
    expect(fetch).toHaveBeenCalled();

    await notifyLiveUpdateDisconnect(env, {
      artifactId,
      audiences: ["dashboard"],
      reason: "takedown",
    });

    const db = {
      async listArtifacts() {
        return { data: [{ id: artifactId }, { id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0" }] };
      },
    } as unknown as Repository;
    await notifyLiveUpdateDisconnectWorkspace(env, db, {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      audiences: ["share", "dashboard"],
      reason: "platform_lockdown",
    });
    expect(fetch.mock.calls.length).toBeGreaterThan(2);
  });

  it("logs and swallows durable object notify failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      ARTIFACT_LIVE: {
        idFromName: () => {
          throw new Error("do unavailable");
        },
        get: () => ({ fetch: vi.fn() }),
      },
    } as never;
    await notifyLiveUpdatePublish(env, {
      artifactId,
      revision: {
        revision_id: pointer.revision_id,
        entrypoint: "index.html",
        render_mode: pointer.render_mode,
        title: pointer.title,
      },
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs non-2xx durable object notify responses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      ARTIFACT_LIVE: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async () => new Response("bad notify", { status: 500 })),
        }),
      },
    } as never;
    await notifyLiveUpdatePublish(env, {
      artifactId,
      revision: {
        revision_id: pointer.revision_id,
        entrypoint: "index.html",
        render_mode: pointer.render_mode,
        title: pointer.title,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Live update notify failed"),
      expect.objectContaining({ status: 500, body: "bad notify" }),
    );
    warn.mockRestore();
  });

  it("swallows workspace list and per-artifact disconnect failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      ARTIFACT_LIVE: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: vi.fn(async () => new Response("ok")) }),
      },
    } as never;

    await notifyLiveUpdateDisconnectWorkspace(
      env,
      {
        async listArtifacts() {
          throw new Error("db down");
        },
      } as unknown as Repository,
      {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        audiences: ["share"],
        reason: "platform_lockdown",
      },
    );
    expect(warn).toHaveBeenCalled();

    warn.mockClear();
    const failingNotifyFetch = vi.fn(async () => new Response("notify failed", { status: 500 }));
    const envWithListedArtifacts = {
      ARTIFACT_LIVE: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: failingNotifyFetch }),
      },
    } as never;
    await notifyLiveUpdateDisconnectWorkspace(
      envWithListedArtifacts,
      {
        async listArtifacts() {
          return { data: [{ id: artifactId }, { id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0" }] };
        },
      } as unknown as Repository,
      {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        audiences: ["share"],
        reason: "platform_lockdown",
      },
    );
    expect(failingNotifyFetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Live update notify failed"),
      expect.objectContaining({ artifactId, status: 500, body: "notify failed" }),
    );
    warn.mockRestore();
  });
});
