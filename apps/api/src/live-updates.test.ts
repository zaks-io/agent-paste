import type { Repository } from "@agent-paste/db";
import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./index.js";
import {
  buildPointerFromPublishResult,
  handleLiveUpdateAuthorize,
  isStreamCaller,
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

afterEach(() => {
  wireLiveUpdateDeps({
    signAgentView: async (view) => view,
    authenticateWeb: async () => null,
  });
});

describe("isStreamCaller", () => {
  it("matches only the stream internal caller header", () => {
    expect(isStreamCaller(new Request("https://api.test/x", { headers: { "x-agent-paste-caller": "stream" } }))).toBe(
      true,
    );
    expect(isStreamCaller(new Request("https://api.test/x"))).toBe(false);
  });
});

describe("handleLiveUpdateAuthorize", () => {
  it("rejects non-stream callers and malformed bodies", async () => {
    const db = {} as Repository;
    const env = { CONTENT_BASE_URL: "https://content.test" } as Env;
    const wrongCaller = await handleLiveUpdateAuthorize(new Request("https://api.test/x"), env, db);
    expect(wrongCaller.status).toBe(404);

    const invalidJson = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", {
        method: "POST",
        headers: { "x-agent-paste-caller": "stream" },
        body: "not-json",
      }),
      env,
      db,
    );
    expect(invalidJson.status).toBe(400);

    const invalidBody = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", {
        method: "POST",
        headers: { "x-agent-paste-caller": "stream", "content-type": "application/json" },
        body: JSON.stringify({ kind: "unknown" }),
      }),
      env,
      db,
    );
    expect(invalidBody.status).toBe(400);
  });

  it("authorizes access links and rejects revision links", async () => {
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
      new Request("https://api.test/x", {
        method: "POST",
        headers: { "x-agent-paste-caller": "stream", "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDEF", blob }),
      }),
      env,
      db,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ audience: "share", artifact_id: artifactId });

    const revisionDenied = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", {
        method: "POST",
        headers: { "x-agent-paste-caller": "stream", "content-type": "application/json" },
        body: JSON.stringify({ kind: "access_link", public_id: "0123456789ABCDFG", blob }),
      }),
      { ...env, ACCESS_LINK_SIGNING_KEY_V1: undefined } as Env,
      db,
    );
    expect(revisionDenied.status).toBe(404);
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
    const env = { CONTENT_BASE_URL: "https://content.test" } as Env;
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
      new Request("https://api.test/x", {
        method: "POST",
        headers: { "x-agent-paste-caller": "stream", "content-type": "application/json" },
        body: JSON.stringify({ kind: "dashboard", artifact_id: artifactId }),
      }),
      env,
      db,
    );
    expect(missingAuth.status).toBe(404);

    const ok = await handleLiveUpdateAuthorize(
      new Request("https://api.test/x", {
        method: "POST",
        headers: {
          "x-agent-paste-caller": "stream",
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
      new Request("https://api.test/x", {
        method: "POST",
        headers: {
          "x-agent-paste-caller": "stream",
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
});

describe("buildPointerFromPublishResult", () => {
  it("returns null for invalid publish payloads", async () => {
    expect(await buildPointerFromPublishResult({} as Env, null, "index.html", "t")).toBeNull();
    expect(await buildPointerFromPublishResult({} as Env, {}, "index.html", "t")).toBeNull();
    expect(await buildPointerFromPublishResult({} as Env, { artifact_id: artifactId }, "index.html", "t")).toBeNull();
    expect(
      await buildPointerFromPublishResult(
        {} as Env,
        { artifact_id: artifactId, revision_id: pointer.revision_id },
        "index.html",
        "t",
      ),
    ).toBeNull();
  });

  it("builds pointers from signed publish results", async () => {
    const built = await buildPointerFromPublishResult(
      {} as Env,
      {
        artifact_id: artifactId,
        revision_id: pointer.revision_id,
        view_url: pointer.iframe_src,
      },
      "index.html",
      pointer.title,
    );
    expect(built).toMatchObject({ iframe_src: pointer.iframe_src, render_mode: "html" });
  });
});

describe("live update notify helpers", () => {
  it("no-ops when bindings or messages are invalid", async () => {
    await notifyLiveUpdatePublish({} as Env, { artifactId: "bad", pointer });
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

    await notifyLiveUpdatePublish(env, { artifactId, pointer });
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
    await notifyLiveUpdatePublish(env, { artifactId, pointer });
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
    await notifyLiveUpdatePublish(env, { artifactId, pointer });
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

    await notifyLiveUpdateDisconnectWorkspace(env, {
      async listArtifacts() {
        throw new Error("db down");
      },
    } as unknown as Repository, {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      audiences: ["share"],
      reason: "platform_lockdown",
    });
    expect(warn).toHaveBeenCalled();

    warn.mockClear();
    const failingNotifyFetch = vi.fn(async () => new Response("notify failed", { status: 500 }));
    const envWithListedArtifacts = {
      ARTIFACT_LIVE: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: failingNotifyFetch }),
      },
    } as never;
    await notifyLiveUpdateDisconnectWorkspace(envWithListedArtifacts, {
      async listArtifacts() {
        return { data: [{ id: artifactId }, { id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0" }] };
      },
    } as unknown as Repository, {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      audiences: ["share"],
      reason: "platform_lockdown",
    });
    expect(failingNotifyFetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Live update notify failed"),
      expect.objectContaining({ artifactId, status: 500, body: "notify failed" }),
    );
    warn.mockRestore();
  });
});
