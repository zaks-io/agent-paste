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
          text: "MCP is not a weaker side channel. It is a core agent surface for publishing text Artifacts, reading Agent Views, adding Revisions, and managing Share Links or Revision Links without shell access.",
        },
      ],
    },
    {
      id: "endpoint",
      title: "Endpoint",
      blocks: [
        {
          kind: "paragraph",
          text: "Production MCP runs at `https://mcp.agent-paste.sh`. The transport endpoint is `POST /` using Streamable HTTP JSON-RPC. Protected Resource Metadata is at `/.well-known/oauth-protected-resource`.",
        },
        {
          kind: "paragraph",
          text: "MCP does not accept API Keys or dashboard cookies. It verifies a WorkOS-issued OAuth bearer token and forwards authenticated calls to `api` and `upload` over service bindings.",
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
            ["`publish_artifact`", "Publish a new text-only Artifact and mint its Revision Link."],
            ["`add_revision`", "Add and publish a new text-only Revision."],
            ["`list_artifacts`", "List Artifacts in the Workspace."],
            ["`read_artifact`", "Read latest Agent View for an Artifact."],
            ["`list_revisions`", "List Revisions for an Artifact."],
            ["`delete_artifact`", "Delete an Artifact."],
            ["`update_display_metadata`", "Update an Artifact display title."],
            ["`create_share_link`", "Create and mint a Share Link for the latest Revision."],
            ["`create_revision_link`", "Create and mint a Revision Link for a specific Revision."],
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
          text: "The MCP publish tools are text-only. Binary uploads, multi-file folder uploads, standalone Bundle downloads, workspace settings, billing, and lockdown controls stay in CLI, REST, or dashboard surfaces.",
        },
        {
          kind: "paragraph",
          text: "`publish_artifact` and `add_revision` accept optional idempotency keys. When omitted, the server derives stable keys from the OAuth subject, JSON-RPC id, and tool name.",
        },
        {
          kind: "paragraph",
          text: "Artifact lifetime follows Workspace Auto Deletion policy. MCP callers do not choose TTL.",
        },
      ],
    },
  ],
};
