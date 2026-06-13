import { describe, expect, it } from "vitest";
import {
  AgentView,
  buildApiOpenApiDocument,
  buildContentOpenApiDocument,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  ErrorCode,
  FinalizeUploadSessionResponse,
  mvpUsagePolicy,
  PublicAgentView,
  PublishResult,
  routeContracts,
  SafetyWarning,
} from "./index.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const isoDate = "2026-05-20T12:00:00.000Z";

type OpenApiDocument = {
  paths?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

describe("MVP route registry", () => {
  it("exposes the CLI-first MVP routes plus web dashboard reads", () => {
    expect(routeContracts.map((route) => route.id)).toEqual([
      "whoami.get",
      "mcp.whoami",
      "usagePolicy.get",
      "apiKeys.revokeCurrent",
      "agentView.public",
      "accessLinks.resolve",
      "cli.version",
      "ephemeral.provision",
      "ephemeral.claim",
      "artifacts.list",
      "artifacts.delete",
      "artifacts.updateDisplayMetadata",
      "accessLinks.create",
      "accessLinks.mint",
      "accessLinks.list",
      "accessLinks.revoke",
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
      "web.accessLinks.listAll",
      "web.accessLinks.listForArtifact",
      "web.revisions.list",
      "web.accessLinks.create",
      "web.accessLinks.mint",
      "web.accessLinks.revoke",
      "web.accessLinks.lockdown.set",
      "web.accessLinks.lockdown.lift",
      "web.audit.list",
      "web.settings.get",
      "web.settings.update",
      "web.admin.lockdown.set",
      "web.admin.lockdown.list",
      "web.admin.lockdown.lift",
      "web.admin.events.list",
      "billing.status.get",
      "billing.invoices.list",
      "billing.checkout.create",
      "billing.checkout.return",
      "billing.portal.create",
      "billing.webhook",
      "billing.admin.setPlan",
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
    expect(
      routeContracts.every((route) => ["none", "actor", "artifact", "ephemeral_provision"].includes(route.rateLimit)),
    ).toBe(true);
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
        "web.accessLinks.create",
        "web.accessLinks.listAll",
        "web.accessLinks.listForArtifact",
        "web.accessLinks.lockdown.lift",
        "web.accessLinks.lockdown.set",
        "web.accessLinks.mint",
        "web.accessLinks.revoke",
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
        "web.revisions.list",
        "web.settings.get",
        "web.settings.update",
        "web.workspace.get",
        "whoami.get",
        "mcp.whoami",
        "artifacts.list",
        "artifacts.delete",
        "artifacts.updateDisplayMetadata",
        "ephemeral.claim",
        "accessLinks.create",
        "accessLinks.mint",
        "accessLinks.list",
        "accessLinks.revoke",
        "billing.status.get",
        "billing.invoices.list",
        "billing.checkout.create",
        "billing.checkout.return",
        "billing.portal.create",
        "billing.admin.setPlan",
      ].sort(),
    );
    expect(
      routeContracts
        .filter((route) => route.rateLimit === "artifact")
        .map((route) => route.id)
        .sort(),
    ).toEqual(["content.bundle", "content.bundleHead", "content.get", "content.head"]);
    expect(routeContracts.find((route) => route.id === "accessLinks.resolve")).toMatchObject({
      auth: "none",
      rateLimit: "none",
    });
  });

  it("keeps operator APIs out of the public OpenAPI document", () => {
    const api = buildApiOpenApiDocument() as OpenApiDocument;

    expect(api.paths).not.toHaveProperty("/v1/web/admin/lockdowns");
    expect(api.paths).not.toHaveProperty("/v1/web/admin/lockdowns/{scope}/{target_id}");
    expect(api.paths).not.toHaveProperty("/v1/web/admin/events");
    expect(api.paths).not.toHaveProperty("/v1/web/admin/workspaces/{workspace_id}/plan");
    expect(api.components?.securitySchemes).not.toHaveProperty("CfAccessServiceToken");
    expect(api.components?.schemas).not.toHaveProperty("SetLockdownRequest");
    expect(api.components?.schemas).not.toHaveProperty("LockdownListResponse");
    expect(api.components?.schemas).not.toHaveProperty("WebOperatorEventListResponse");
    expect(api.components?.schemas).not.toHaveProperty("SetWorkspacePlanRequest");
    expect(api.security).not.toContainEqual({ CfAccessServiceToken: [] });
  });

  it("can still generate an operator-inclusive API document explicitly", () => {
    const api = buildApiOpenApiDocument({ includeOperatorPaths: true }) as OpenApiDocument;

    expect(api.paths).toHaveProperty("/v1/web/admin/lockdowns");
    expect(api.paths).toHaveProperty("/v1/web/admin/lockdowns/{scope}/{target_id}");
    expect(api.paths).toHaveProperty("/v1/web/admin/events");
    expect(api.paths).toHaveProperty("/v1/web/admin/workspaces/{workspace_id}/plan");
    expect(api.components?.securitySchemes).toHaveProperty("CfAccessServiceToken");
    expect(api.components?.schemas).toHaveProperty("SetLockdownRequest");
    expect(api.components?.schemas).toHaveProperty("LockdownListResponse");
    expect(api.components?.schemas).toHaveProperty("WebOperatorEventListResponse");
    expect(api.components?.schemas).toHaveProperty("SetWorkspacePlanRequest");
    expect(api.security).toContainEqual({ CfAccessServiceToken: [] });
  });

  it("keeps Access Link management guarded by the share-capability representation", () => {
    const scopesFor = (id: string) => routeContracts.find((route) => route.id === id)?.scopes;

    expect(
      Object.fromEntries(
        ["web.accessLinks.listAll", "web.accessLinks.listForArtifact"].map((id) => [id, scopesFor(id)]),
      ),
    ).toEqual({
      "web.accessLinks.listAll": ["read"],
      "web.accessLinks.listForArtifact": ["read"],
    });
    expect(
      Object.fromEntries(
        [
          "web.accessLinks.create",
          "web.accessLinks.mint",
          "web.accessLinks.revoke",
          "web.accessLinks.lockdown.set",
          "web.accessLinks.lockdown.lift",
        ].map((id) => [id, scopesFor(id)]),
      ),
    ).toEqual({
      "web.accessLinks.create": ["admin"],
      "web.accessLinks.mint": ["admin"],
      "web.accessLinks.revoke": ["admin"],
      "web.accessLinks.lockdown.set": ["admin"],
      "web.accessLinks.lockdown.lift": ["admin"],
    });
    expect(
      Object.fromEntries(
        ["accessLinks.create", "accessLinks.mint", "accessLinks.list", "accessLinks.revoke"].map((id) => [
          id,
          scopesFor(id),
        ]),
      ),
    ).toEqual({
      "accessLinks.create": ["admin"],
      "accessLinks.mint": ["admin"],
      "accessLinks.list": ["admin"],
      "accessLinks.revoke": ["admin"],
    });
  });

  it("documents handler-level public Agent View throttling", () => {
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
    expect(publicAgentView?.rateLimit).toBe("none");
    expect(publicAgentView?.responseSchema).toBe("PublicAgentView");
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
      daily_new_artifact_allowance: 100,
      lifetime_revision_ceiling: 100,
    });

    expect(
      CreateUploadSessionRequest.safeParse({
        title: "too large",
        ttl_seconds: 24 * 60 * 60,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 25 * 1024 * 1024 + 1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts digest manifests, upload-required targets, reused targets, and legacy no-hash manifests", () => {
    const sha256 = "a".repeat(64);
    expect(
      CreateUploadSessionRequest.parse({
        title: "hashed",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12, sha256 }],
      }).files[0],
    ).toMatchObject({ sha256 });
    expect(
      CreateUploadSessionRequest.parse({
        title: "legacy",
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      }).files[0],
    ).not.toHaveProperty("sha256");

    expect(() =>
      CreateUploadSessionResponse.parse({
        upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "pending",
        expires_at: isoDate,
        files: [
          {
            status: "upload_required",
            path: "index.html",
            put_url: "https://upload.example/put",
            required_headers: {},
            expires_at: isoDate,
          },
          { status: "reused", path: "style.css" },
        ],
      }),
    ).not.toThrow();
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
        revision_content_url: "https://usercontent.agent-paste.sh/v/token/index.html",
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

  it("keeps public Agent View responses on the lockdown-free schema", () => {
    PublicAgentView.parse({
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      title: "public",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
      entrypoint: "index.html",
      revision_content_url:
        "https://content.test/v/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9.rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/index.html",
      files: [
        {
          path: "index.html",
          url: "https://content.test/v/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9.rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/index.html",
          content_type: "text/html",
          size_bytes: 12,
        },
      ],
      safety_warnings: [],
      bundle: { status: "pending", retry_after_seconds: 5 },
    });

    const api = buildApiOpenApiDocument() as {
      paths?: Record<
        string,
        { get?: { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> } }
      >;
      components?: { schemas?: Record<string, unknown> };
    };
    const publicResponse = api.paths?.["/v1/public/agent-view/{token}"]?.get?.responses?.["200"];
    const schema = publicResponse?.content?.["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/PublicAgentView" });
    expect(api.components?.schemas?.PublicAgentView).not.toHaveProperty("properties.lockdown");
  });

  it("allows authenticated Agent View responses to carry explicit lockdown state", () => {
    expect(
      AgentView.parse({
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "locked demo",
        created_at: isoDate,
        expires_at: "2026-06-19T12:00:00.000Z",
        entrypoint: "index.html",
        revision_content_url: "https://usercontent.agent-paste.sh/v/token/index.html",
        files: [
          {
            path: "index.html",
            size_bytes: 123,
            content_type: "text/html; charset=utf-8",
            url: "https://usercontent.agent-paste.sh/v/token/index.html",
          },
        ],
        bundle: { status: "pending", retry_after_seconds: 5 },
        lockdown: {
          access_link: { locked: true, locked_at: "2026-06-01T12:00:00.000Z" },
          platform: {
            workspace: { locked: false, locked_at: null },
            artifact: { locked: true, locked_at: "2026-06-02T12:00:00.000Z" },
          },
        },
      }),
    ).toMatchObject({
      lockdown: {
        access_link: { locked: true },
        platform: { artifact: { locked: true } },
      },
    });
  });

  it("enforces Safety Warning scope and file path invariants", () => {
    expect(
      SafetyWarning.safeParse({
        code: "credential_collection_form",
        severity: "warning",
        scope: "file",
        message: "This revision contains an HTML password form.",
        detected_at: isoDate,
      }).success,
    ).toBe(false);
    expect(
      SafetyWarning.safeParse({
        code: "artifact_notice",
        severity: "info",
        scope: "artifact",
        file_path: "index.html",
        message: "Artifact-level warning.",
        detected_at: isoDate,
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
        artifact_url: "https://app.agent-paste.sh/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        access_link_url: "https://app.agent-paste.sh/al/01HZY7Q8X9Y2S3T4#secret",
        revision_content_url: "https://usercontent.agent-paste.sh/v/token/index.html",
        agent_view_url: "https://api.agent-paste.sh/v1/public/agent-view/token",
        expires_at: "2026-06-19T12:00:00.000Z",
      }),
    ).toMatchObject({ title: "demo" });
  });
});
