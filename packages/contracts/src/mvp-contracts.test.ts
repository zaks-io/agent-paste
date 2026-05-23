import { describe, expect, it } from "vitest";
import {
  AgentView,
  buildContentOpenApiDocument,
  CreateUploadSessionRequest,
  ErrorCode,
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
      "usagePolicy.get",
      "agentView.public",
      "web.auth.callback",
      "web.workspace.get",
      "web.artifacts.list",
      "web.artifacts.get",
      "web.apiKeys.list",
      "web.audit.list",
      "web.settings.get",
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "content.get",
      "admin.workspaces.create",
      "admin.workspaces.list",
      "admin.apiKeys.create",
      "admin.apiKeys.revoke",
      "admin.artifacts.list",
      "admin.artifacts.get",
      "admin.artifacts.delete",
      "admin.cleanup.run",
      "admin.operationEvents.list",
    ]);
  });

  it("documents artifact-level content read throttling", () => {
    const contentGet = routeContracts.find((route) => route.id === "content.get");
    const contentOpenApi = JSON.stringify(buildContentOpenApiDocument());

    expect(ErrorCode.options).toContain("rate_limited_artifact");
    expect(contentGet?.errors).toContain("rate_limited_artifact");
    expect(contentOpenApi).toContain('"429"');
    expect(contentOpenApi).toContain("Retry-After");
    expect(contentOpenApi).toContain("rate_limited_artifact");
  });
});

describe("MVP schemas", () => {
  it("keeps upload-session caps at the documented MVP values", () => {
    expect(mvpUsagePolicy).toMatchObject({
      file_size_cap_bytes: 10 * 1024 * 1024,
      artifact_size_cap_bytes: 25 * 1024 * 1024,
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

  it("keeps finalize wired to the small PublishResult shape", () => {
    expect(
      PublishResult.parse({
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "demo",
        view_url: "https://usercontent.agent-paste.sh/v/token/index.html",
        agent_view_url: "https://api.agent-paste.sh/v1/public/agent-view/token",
        expires_at: "2026-06-19T12:00:00.000Z",
      }),
    ).toMatchObject({ title: "demo" });
  });
});
