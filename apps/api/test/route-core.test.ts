import { IdempotencyInFlightError } from "@agent-paste/commands";
import { describe, expect, it, vi } from "vitest";
import {
  entrypointPathFromViewUrl,
  signAgentViewContentUrls,
  signPublishResult,
  verifyAgentViewTokenForEnv,
} from "../src/agent-view.js";
import { htmlAgentViewResponse, wantsHtml } from "../src/agent-view-html.js";
import { authenticateSmokeHarness, bearerToken, createApiAuthResolvers, isNonProductionEnv } from "../src/auth.js";
import type { Env } from "../src/env.js";
import { parsePagination } from "../src/pagination.js";
import { apiKeyActor, platformActor, webMemberActor, workspaceApiActor } from "../src/principals.js";
import { mapRepositoryError, RepositoryRouteError, readJsonObject, runIdempotent } from "../src/responses.js";
import { contractById } from "../src/route-contracts.js";
import {
  apiBaseUrl,
  apiDatabase,
  apiRateLimitBindings,
  contentBaseUrl,
  postgresRuntime,
  webBaseUrl,
} from "../src/runtime.js";
import {
  apiActor,
  apiPrincipal,
  contextFor,
  memberPrincipal,
  nonePrincipal,
  operatorPrincipal,
  responseJson,
  workspaceId,
} from "./route-test-helpers.js";

describe("AP-91 shared API route helpers", () => {
  it("parses pagination limits and rejects empty cursors", () => {
    expect(parsePagination(new Request("https://api.test/items?limit=25&cursor=abc"))).toEqual({
      ok: true,
      value: { limit: 25, cursor: "abc" },
    });
    expect(parsePagination(new Request("https://api.test/items?cursor="))).toEqual({
      ok: false,
      code: "invalid_cursor",
    });
    expect(parsePagination(new Request("https://api.test/items?limit=101"))).toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it("normalizes principals by route surface", () => {
    expect(workspaceApiActor(apiPrincipal())).toEqual(apiActor);
    expect(workspaceApiActor(memberPrincipal())).toEqual(expect.objectContaining({ type: "member" }));
    expect(workspaceApiActor(operatorPrincipal())).toBeNull();
    expect(webMemberActor(memberPrincipal())).toEqual(expect.objectContaining({ id: "mem_1" }));
    expect(webMemberActor(nonePrincipal())).toBeNull();
    expect(apiKeyActor(apiPrincipal())).toEqual(apiActor);
    expect(apiKeyActor(memberPrincipal())).toBeNull();
    expect(platformActor(operatorPrincipal("Ops@Example.com"))).toEqual({ type: "platform", id: "Ops@Example.com" });
    expect(platformActor(nonePrincipal())).toBeNull();
  });

  it("maps idempotency and repository route errors to API envelopes", async () => {
    const context = contextFor({ env: { DOCS_BASE_URL: "https://docs.test" } });
    const inFlight = await runIdempotent(context, async () => {
      throw new IdempotencyInFlightError();
    });
    expect(inFlight.status).toBe(409);
    expect(await responseJson(inFlight)).toMatchObject({
      error: { code: "idempotency_in_flight", docs: "https://docs.test/errors/idempotency_in_flight" },
    });

    const mapped = await runIdempotent(context, async () => {
      throw new RepositoryRouteError("invalid_request", "bad route body");
    });
    expect(mapped.status).toBe(400);
    expect(await responseJson(mapped)).toMatchObject({ error: { code: "invalid_request", message: "bad route body" } });
  });

  it("reads optional JSON request bodies defensively", async () => {
    await expect(readJsonObject(new Request("https://api.test", { method: "POST", body: "plain" }))).resolves.toEqual(
      {},
    );
    await expect(
      readJsonObject(
        new Request("https://api.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[1,2,3]",
        }),
      ),
    ).resolves.toEqual({});
    await expect(
      readJsonObject(
        new Request("https://api.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("maps known repository errors and preserves unknown failures", () => {
    expect(mapRepositoryError(new Error("artifact_not_found"))).toEqual({ code: "artifact_not_found" });
    expect(mapRepositoryError(new Error("invalid_ttl_seconds"))).toEqual({ code: "invalid_request" });
    expect(mapRepositoryError(new Error("unknown"))).toBeNull();
    expect(mapRepositoryError("artifact_not_found")).toBeNull();
  });

  it("finds route contracts by id and fails loudly for missing ids", () => {
    expect(contractById("whoami.get")).toMatchObject({ id: "whoami.get", app: "api" });
    expect(() => contractById("missing.route" as never)).toThrow("Missing route contract missing.route");
  });

  it("resolves runtime bindings and public base URLs", () => {
    const db = { getWhoami: vi.fn() };
    const env = {
      DB: db,
      ACTOR_RATE_LIMIT: { limit: vi.fn() },
      WORKSPACE_BURST_CAP: { limit: vi.fn() },
      ARTIFACT_RATE_LIMIT: { limit: vi.fn() },
      API_BASE_URL: "https://api.custom",
      CONTENT_BASE_URL: "https://content.custom",
      WEB_BASE_URL: "https://web.custom",
    } as unknown as Env;

    expect(apiDatabase(env)).toBe(db);
    expect(postgresRuntime({ DB: { connectionString: "postgres://example" } } as Env)).toBeUndefined();
    expect(apiRateLimitBindings(env)).toMatchObject({
      actor: env.ACTOR_RATE_LIMIT,
      workspace: env.WORKSPACE_BURST_CAP,
      artifact: env.ARTIFACT_RATE_LIMIT,
    });
    expect(apiBaseUrl(env)).toBe("https://api.custom");
    expect(contentBaseUrl(env)).toBe("https://content.custom");
    expect(webBaseUrl(env)).toBe("https://web.custom");
    expect(apiBaseUrl({})).toBe("https://api.agent-paste.sh");
  });

  it("authenticates bearer, smoke, signed-view, and WorkOS principals through exported auth resolvers", async () => {
    expect(bearerToken(new Request("https://api.test", { headers: { authorization: "Bearer secret" } }))).toBe(
      "secret",
    );
    expect(
      authenticateSmokeHarness(new Request("https://api.test", { headers: { authorization: "Bearer s" } }), {
        SMOKE_HARNESS_SECRET: "s",
      }),
    ).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "preview" })).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "production" })).toBe(false);

    const resolvers = createApiAuthResolvers();
    const signedMissing = await resolvers.signed_agent_view_token(contextFor() as never);
    expect(signedMissing).toEqual({ ok: false, code: "not_found" });

    const identity = { workos_user_id: "user_1", email: "member@example.com", token_id: "jti_1" };
    const workos = await resolvers.workos_access_token(
      contextFor({
        headers: { authorization: "Bearer web" },
        env: {
          AUTH: {
            async verifyApiKey() {
              return null;
            },
            async verifyWebToken() {
              return identity;
            },
          },
        },
      }) as never,
      { id: "web.auth.callback", allowUnprovisioned: true } as never,
    );
    expect(workos).toMatchObject({ ok: true, principal: { identity } });
  });

  it("sets noindex and script_disabled on signed content URLs when the agent view is ephemeral tier", async () => {
    const signed = (await signAgentViewContentUrls(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
        ephemeral_tier: true,
        files: [{ path: "index.html", url: "old" }],
      },
      { CONTENT_SIGNING_SECRET: "content-secret", CONTENT_BASE_URL: "https://content.test" },
      { workspaceId },
    )) as { view_url: string };

    const token = decodeURIComponent(signed.view_url.split("/v/")[1]?.split("/")[0] ?? "");
    const { verifyContentToken } = await import("@agent-paste/tokens/content");
    const payload = await verifyContentToken(token, "content-secret");
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
      { CONTENT_SIGNING_SECRET: "content-secret", CONTENT_BASE_URL: "https://content.test" },
      { workspaceId },
    )) as { view_url: string };

    const token = decodeURIComponent(signed.view_url.split("/v/")[1]?.split("/")[0] ?? "");
    const { verifyContentToken } = await import("@agent-paste/tokens/content");
    const payload = await verifyContentToken(token, "content-secret");
    expect(payload?.script_disabled).toBe(false);
  });

  it("signs Agent View content URLs without leaking internal workspace fields", async () => {
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
      { CONTENT_SIGNING_SECRET: "content-secret", CONTENT_BASE_URL: "https://content.test" },
      { workspaceId, accessLinkId: "al_1" },
    )) as { workspace_id?: string; view_url: string; files: Array<{ url: string }>; bundle: { url: string } };

    expect(signed.workspace_id).toBeUndefined();
    expect(signed.view_url).toContain("https://content.test/v/");
    expect(signed.view_url).toContain("/nested/index.html");
    expect(signed.files[0]?.url).toContain("https://content.test/v/");
    expect(signed.files[0]?.url).toContain("/nested/index.html");
    expect(signed.files[1]?.url).toBe("kept");
    expect(signed.bundle.url).toContain("https://content.test/");
  });

  it("falls back to public Agent View URLs when no Agent View signer is configured", async () => {
    await expect(verifyAgentViewTokenForEnv("bad", {})).resolves.toBeNull();
    expect(await signAgentViewContentUrls(null, {})).toBeNull();
    const signed = (await signPublishResult(
      { artifact_id: "art_1", revision_id: "rev_1", view_url: "https://old.test/v/art.rev/docs%2Findex.html" },
      { API_BASE_URL: "https://api.test", CONTENT_BASE_URL: "https://content.test" },
    )) as { view_url: string; agent_view_url: string };
    expect(signed.view_url).toBe("https://content.test/v/art_1.rev_1/docs/index.html");
    expect(signed.agent_view_url).toBe("https://api.test/v1/public/agent-view/art_1.rev_1");
    expect(entrypointPathFromViewUrl("not-a-view-url")).toBe("index.html");
  });

  it("renders HTML Agent View responses with escaped untrusted fields", async () => {
    expect(wantsHtml(new Request("https://api.test", { headers: { accept: "text/html" } }))).toBe(true);
    expect(wantsHtml(new Request("https://api.test", { headers: { accept: "application/json, text/html" } }))).toBe(
      false,
    );

    const response = htmlAgentViewResponse(contextFor(), {
      title: "<script>",
      artifact_id: "art_1",
      revision_id: "rev_1",
      view_url: 'https://content.test/"',
      files: [{ path: "<index>.html", url: "https://content.test/`", content_type: "text/html", size_bytes: 12 }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("&#96;");
    expect(body).not.toContain("<script>");
  });

  it("adds noindex headers and meta for ephemeral-tier HTML agent views", async () => {
    const response = htmlAgentViewResponse(contextFor(), {
      title: "Ephemeral",
      artifact_id: "art_1",
      revision_id: "rev_1",
      ephemeral_tier: true,
      view_url: "https://content.test/v/token/index.html",
      files: [],
    });

    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.toContain('<meta name="robots" content="noindex,nofollow">');
  });
});
