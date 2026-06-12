import type { DocsPage } from "../types";

export const MCP_DOC: DocsPage = {
  slug: "mcp",
  title: "MCP Server",
  shortTitle: "MCP",
  summary:
    "Hosted agents without CLI access can publish, inspect, revise, and share text Artifacts over OAuth-only MCP.",
  sections: [
    {
      id: "when-to-use",
      title: "When to use MCP",
      blocks: [
        {
          kind: "paragraph",
          text: "Use MCP when an agent runs inside a hosted tool that can connect to remote MCP servers but cannot install npm packages, spawn a CLI, or use a local keychain.",
        },
        {
          kind: "paragraph",
          text: "MCP is not a weaker side channel. It is the hosted-agent surface for publishing text Artifacts, reading Agent Views, adding Revisions, and explicitly managing Share Links and snapshot links without shell access.",
        },
      ],
    },
    {
      id: "endpoint",
      title: "Endpoint",
      blocks: [
        {
          kind: "paragraph",
          text: "Production MCP runs at `https://mcp.agent-paste.sh`. The transport endpoint is `POST /` using Streamable HTTP JSON-RPC. Protected Resource Metadata is at `/.well-known/oauth-protected-resource`; the root OAuth resource is `https://mcp.agent-paste.sh/`.",
        },
        {
          kind: "paragraph",
          text: "MCP verifies a WorkOS-issued OAuth bearer token and forwards authenticated calls to `api` and `upload` over service bindings. Dashboard cookies and local CLI credentials do not authenticate MCP calls.",
        },
        {
          kind: "paragraph",
          text: "Connect `https://mcp.agent-paste.sh` in the host, complete OAuth, then run `whoami` first. The WorkOS user must already belong to a Workspace, which dashboard sign-in or `agent-paste login` creates.",
        },
      ],
    },
    {
      id: "scopes",
      title: "Capability scopes",
      blocks: [
        {
          kind: "paragraph",
          text: "WorkOS AuthKit tokens carry standard OAuth scopes. agent-paste derives MCP capabilities from the authenticated Workspace Member in `api`: `read`, `write`, and `share`.",
        },
        {
          kind: "table",
          columns: ["MCP scope", "Backed by", "Typical tools"],
          rows: [
            ["`read`", "member `read`", "`whoami`, `list_artifacts`, `read_artifact`, `list_revisions`"],
            [
              "`write`",
              "member `publish`",
              "`publish_artifact`, `add_revision`, `delete_artifact`, `update_display_metadata`",
            ],
            [
              "`share`",
              "member `admin`",
              "`create_share_link`, `create_revision_link`, `list_access_links`, `revoke_access_link`",
            ],
          ],
        },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      blocks: [
        {
          kind: "table",
          columns: ["Tool", "Purpose"],
          rows: [
            ["`whoami`", "Return authenticated member, Workspace, and derived scopes."],
            ["`publish_artifact`", "Publish a new text-only Artifact without creating a public link by default."],
            [
              "`add_revision`",
              "Add and publish a new text-only Revision without creating or reusing a Share Link by default.",
            ],
            ["`list_artifacts`", "List Artifacts in the Workspace."],
            ["`read_artifact`", "Read latest Agent View for an Artifact."],
            ["`list_revisions`", "List Revisions for an Artifact."],
            ["`delete_artifact`", "Delete an Artifact."],
            ["`update_display_metadata`", "Update an Artifact display title."],
            ["`create_share_link`", "Create a Share Link and mint its Access Link Signed URL."],
            ["`create_revision_link`", "Create and mint a snapshot Access Link for a specific Revision."],
            ["`list_access_links`", "List Share Links and Revision Links for an Artifact."],
            ["`revoke_access_link`", "Revoke a Share Link or Revision Link."],
          ],
        },
      ],
    },
    {
      id: "limits",
      title: "Limits",
      blocks: [
        {
          kind: "paragraph",
          text: "The MCP publish tools are text-only. Binary uploads, multi-file folder uploads, and standalone Bundle downloads stay in the CLI. Workspace settings, billing, and lockdown controls stay in the dashboard.",
        },
        {
          kind: "paragraph",
          text: "`publish_artifact` and `add_revision` default `share` to `false` and do not create or reuse Share Links by default. Set `share: true` only when the user explicitly asks for a public/shareable Access Link; then `publish_artifact` creates a Share Link and `add_revision` reuses an active Share Link when possible, creating one only when needed, and returns `access_link_url`. MCP publish output intentionally omits Artifact IDs, Revision IDs, `artifact_url`, `revision_content_url`, and `agent_view_url`; use explicit read/list/link tools when those fields are needed. The tools also accept optional idempotency keys. When omitted, the server derives stable keys from the OAuth subject, JSON-RPC id, and tool name.",
        },
        {
          kind: "paragraph",
          text: "Artifact lifetime follows Workspace Auto Deletion policy. MCP callers do not choose TTL.",
        },
      ],
    },
  ],
};
