import { describe, expect, it } from "vitest";
import {
  AgentView,
  buildApiOpenApiDocument,
  buildContentOpenApiDocument,
  CreateUploadSessionRequest,
  ErrorCode,
  FinalizeUploadSessionResponse,
  mvpUsagePolicy,
  PublishResult,
  routeContracts,
} from "./index.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const isoDate = "2026-05-20T12:00:00.000Z";

describe("MVP route registry", () => {
  it("exposes the CLI-first MVP routes plus web dashboard reads", () => {
    expect(routeContracts.map((route) => route.id)).toEqual([
      "whoami.get",
      "mcp.whoami",
      "usagePolicy.get",
      "apiKeys.revokeCurrent",
      "agentView.public",
      "accessLinks.resolve",
      "agentView.getLatest",
      "agentView.getRevision",
      "revisions.list",
      "revisions.publish",
      "web.auth.callback",
      "web.workspace.get",
      "web.artifacts.list",
      "web.artifacts.get",
      "web.artifacts.pin",
      "web.artifacts.unpin",
      "web.apiKeys.list",
      "web.apiKeys.create",
      "web.apiKeys.revoke",
      "web.audit.list",
      "web.settings.get",
      "web.settings.update",
      "web.admin.lockdown.set",
      "web.admin.lockdown.list",
      "web.admin.lockdown.lift",
      "web.admin.events.list",
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "content.get",
      "content.head",
      "content.bundle",
      "content.bundleHead",
    ]);
  });

  it("declares runtime rate-limit classes for every route", () => {
    expect(routeContracts.every((route) => ["none", "actor", "artifact"].includes(route.rateLimit))).toBe(true);
    expect(
      routeContracts
        .filter((route) => route.rateLimit === "actor")
        .map((route) => route.id)
        .sort(),
    ).toEqual(
      [
        "agentView.getLatest",
        "agentView.getRevision",
        "apiKeys.revokeCurrent",
        "revisions.list",
        "revisions.publish",
        "uploadSessions.create",
        "uploadSessions.finalize",
        "web.admin.events.list",
        "web.admin.lockdown.lift",
        "web.admin.lockdown.list",
        "web.admin.lockdown.set",
        "web.apiKeys.create",
        "web.apiKeys.list",
        "web.apiKeys.revoke",
        "web.artifacts.get",
        "web.artifacts.list",
        "web.artifacts.pin",
        "web.artifacts.unpin",
        "web.audit.list",
        "web.settings.get",
        "web.settings.update",
        "web.workspace.get",
        "whoami.get",
        "mcp.whoami",
      ].sort(),
    );
    expect(
      routeContracts
        .filter((route) => route.rateLimit === "artifact")
        .map((route) => route.id)
        .sort(),
    ).toEqual(["agentView.public", "content.bundle", "content.bundleHead", "content.get", "content.head"]);
    expect(routeContracts.find((route) => route.id === "accessLinks.resolve")).toMatchObject({
      auth: "none",
      rateLimit: "none",
    });
  });

  it("documents artifact-level public Agent View throttling", () => {
    const publicAgentView = routeContracts.find((route) => route.id === "agentView.public");
    const apiOpenApi = buildApiOpenApiDocument() as {
      paths?: Record<
        string,
        {
          get?: {
            responses?: Record<
              string,
              {
                headers?: Record<string, unknown>;
                content?: Record<string, { schema?: { $ref?: string } }>;
              }
            >;
          };
        }
      >;
      components?: { schemas?: Record<string, unknown> };
    };
    const rateLimitResponse = apiOpenApi.paths?.["/v1/public/agent-view/{token}"]?.get?.responses?.["429"];

    expect(publicAgentView).toBeDefined();
    expect(publicAgentView?.errors).toContain("rate_limited_artifact");
    expect(rateLimitResponse).toBeDefined();
    expect(rateLimitResponse?.headers).toHaveProperty("Retry-After");
    expect(rateLimitResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ArtifactRateLimitErrorEnvelope",
    );
    expect(apiOpenApi.components?.schemas?.ArtifactRateLimitErrorEnvelope).toMatchObject({
      properties: { error: { properties: { code: { enum: ["rate_limited_artifact"] } } } },
    });
  });

  it("documents artifact-level content read throttling", () => {
    const contentGet = routeContracts.find((route) => route.id === "content.get");
    const contentHead = routeContracts.find((route) => route.id === "content.head");
    const contentOpenApi = buildContentOpenApiDocument() as {
      paths?: Record<
        string,
        {
          get?: {
            responses?: Record<
              string,
              {
                headers?: Record<string, unknown>;
                content?: Record<string, { schema?: { $ref?: string } }>;
              }
            >;
          };
          head?: {
            responses?: Record<
              string,
              {
                headers?: Record<string, unknown>;
                content?: Record<string, { schema?: { $ref?: string } }>;
              }
            >;
          };
        }
      >;
      components?: { schemas?: Record<string, unknown> };
    };
    const rateLimitResponse = contentOpenApi.paths?.["/v/{token}/{path}"]?.get?.responses?.["429"];
    const notFoundResponse = contentOpenApi.paths?.["/v/{token}/{path}"]?.get?.responses?.["404"];
    const headRateLimitResponse = contentOpenApi.paths?.["/v/{token}/{path}"]?.head?.responses?.["429"];
    const headNotFoundResponse = contentOpenApi.paths?.["/v/{token}/{path}"]?.head?.responses?.["404"];

    expect(ErrorCode.options).toContain("rate_limited_artifact");
    expect(contentGet).toBeDefined();
    expect(contentGet?.errors).toContain("rate_limited_artifact");
    expect(contentHead).toBeDefined();
    expect(contentHead?.errors).toContain("rate_limited_artifact");
    expect(rateLimitResponse).toBeDefined();
    expect(rateLimitResponse?.headers).toHaveProperty("Retry-After");
    expect(rateLimitResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ArtifactRateLimitErrorEnvelope",
    );
    expect(contentOpenApi.components?.schemas?.ArtifactRateLimitErrorEnvelope).toMatchObject({
      properties: { error: { properties: { code: { enum: ["rate_limited_artifact"] } } } },
    });
    expect(notFoundResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ContentNotFoundErrorEnvelope",
    );
    expect(contentOpenApi.components?.schemas?.ContentNotFoundErrorEnvelope).toMatchObject({
      properties: { error: { properties: { code: { enum: ["not_found"] } } } },
    });
    expect(headRateLimitResponse).toBeDefined();
    expect(headRateLimitResponse?.headers).toHaveProperty("Retry-After");
    expect(headRateLimitResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ArtifactRateLimitErrorEnvelope",
    );
    expect(headNotFoundResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/ContentNotFoundErrorEnvelope",
    );
  });
});

describe("MVP schemas", () => {
  it("keeps upload-session caps at the documented MVP values", () => {
    expect(mvpUsagePolicy).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      artifact_size_cap_bytes: 25 * 1024 * 1024,
      bundle_size_cap_bytes: 25 * 1024 * 1024,
      bundles_enabled: true,
      file_count_cap: 100,
    });

    expect(
      CreateUploadSessionRequest.safeParse({
        title: "too large",
        ttl_seconds: 24 * 60 * 60,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 10 * 1024 * 1024 + 1 }],
      }).success,
    ).toBe(false);
  });

  it("uses full per-file URLs in public Agent View instead of content_prefix", () => {
    expect(
      AgentView.parse({
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "demo",
        created_at: isoDate,
        expires_at: "2026-06-19T12:00:00.000Z",
        entrypoint: "index.html",
        view_url: "https://usercontent.agent-paste.sh/v/token/index.html",
        files: [
          {
            path: "index.html",
            size_bytes: 123,
            content_type: "text/html; charset=utf-8",
            url: "https://usercontent.agent-paste.sh/v/token/index.html",
          },
        ],
        bundle: { status: "pending", retry_after_seconds: 5 },
      }),
    ).toMatchObject({ title: "demo" });

    expect(
      AgentView.safeParse({
        manifest: {},
        content_prefix: "https://usercontent.agent-paste.sh/v/token/",
        files: [],
      }).success,
    ).toBe(false);
  });

  it("keeps finalize wired to the draft FinalizeUploadSessionResponse shape", () => {
    expect(
      FinalizeUploadSessionResponse.parse({
        upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "draft",
        title: "demo",
        entrypoint: "index.html",
        file_count: 1,
        size_bytes: 123,
      }),
    ).toMatchObject({ status: "draft" });
  });

  it("keeps publish wired to the PublishResult shape", () => {
    expect(
      PublishResult.parse({
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "demo",
        bundle: { status: "pending", retry_after_seconds: 5 },
        view_url: "https://usercontent.agent-paste.sh/v/token/index.html",
        agent_view_url: "https://api.agent-paste.sh/v1/public/agent-view/token",
        expires_at: "2026-06-19T12:00:00.000Z",
      }),
    ).toMatchObject({ title: "demo" });
  });
});
