import type { DocsPage } from "../types";

export const REST_API_DOC: DocsPage = {
  slug: "rest-api",
  title: "REST API",
  shortTitle: "REST",
  summary: "Use REST when the CLI is the wrong runtime for your agent or service.",
  sections: [
    {
      id: "hosts",
      title: "Hosts",
      blocks: [
        {
          kind: "table",
          columns: ["Host", "Purpose"],
          rows: [
            [
              "`https://api.agent-paste.sh`",
              "Control plane, Agent View, web API, ephemeral provision/claim, billing routes, and OpenAPI.",
            ],
            ["`https://upload.agent-paste.sh`", "Upload Sessions and signed file PUT URLs."],
            [
              "`https://usercontent.agent-paste.sh`",
              "Signed content and Bundle reads from isolated untrusted-content origin.",
            ],
            ["`https://app.agent-paste.sh`", "Dashboard, Access Link viewer, claim page, and billing UI."],
            ["`https://mcp.agent-paste.sh`", "OAuth-only MCP transport."],
          ],
        },
      ],
    },
    {
      id: "auth",
      title: "Authentication",
      blocks: [
        {
          kind: "paragraph",
          text: "API clients send `Authorization: Bearer ap_pk_...`. Use dashboard-created keys or the key minted by `agent-paste login`. Public Agent View, Access Link resolve, signed content, and signed Bundle URLs use signed tokens instead of API Keys.",
        },
      ],
    },
    {
      id: "publish-flow",
      title: "Publish flow",
      blocks: [
        {
          kind: "ordered",
          items: [
            "Create an Upload Session with file metadata and an `Idempotency-Key`.",
            "PUT each file to the returned signed upload-worker URL.",
            "Finalize the Upload Session with an `Idempotency-Key`.",
            "Publish the finalized Revision. The response includes human and agent URLs.",
          ],
        },
      ],
    },
    {
      id: "common-routes",
      title: "Common routes",
      blocks: [
        {
          kind: "table",
          columns: ["Route", "Use"],
          rows: [
            ["`GET /v1/whoami`", "Verify API Key identity and Workspace."],
            ["`GET /v1/usage-policy`", "Read effective limits for the caller's Workspace."],
            ["`GET /v1/artifacts/{id}/agent-view`", "Read latest authenticated Agent View."],
            [
              "`GET /v1/artifacts/{id}/revisions/{revision_id}/agent-view`",
              "Read Revision-pinned authenticated Agent View.",
            ],
            ["`GET /v1/public/agent-view/{token}`", "Read public signed Agent View."],
            ["`POST /v1/ephemeral/provision`", "Provision an Ephemeral Workspace and short-lived key."],
          ],
        },
        {
          kind: "links",
          links: [
            { label: "API OpenAPI", href: "https://api.agent-paste.sh/openapi.json" },
            { label: "Upload OpenAPI", href: "https://upload.agent-paste.sh/openapi.json" },
            { label: "Content OpenAPI", href: "https://usercontent.agent-paste.sh/openapi.json" },
          ],
        },
      ],
    },
  ],
};
