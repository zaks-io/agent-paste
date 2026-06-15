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
          text: "Production MCP runs at `https://mcp.agent-paste.sh`. Opening `GET /` returns endpoint metadata for humans and agents. Protocol calls use `POST /` with Streamable HTTP JSON-RPC and an OAuth bearer token. Protected Resource Metadata is at `/.well-known/oauth-protected-resource`; the root OAuth resource is `https://mcp.agent-paste.sh/`.",
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
          text: "WorkOS AuthKit tokens carry standard OAuth scopes. agent-paste derives capabilities from the authenticated Workspace Member in `api`, using one shared scope vocabulary: `read` and `publish` (`admin` is dashboard-only and no MCP tool needs it).",
        },
        {
          kind: "table",
          columns: ["Scope", "Grants", "Tools"],
          rows: [
            [
              "`read`",
              "View your own Artifacts and links",
              "`whoami`, `list_artifacts`, `read_artifact`, `read_file`, `list_revisions`, `list_access_links`",
            ],
            [
              "`publish`",
              "Change your own content and manage its public access",
              "`publish_artifact`, `add_revision`, `multi_edit`, `delete_artifact`, `update_display_metadata`, `make_public`, `create_revision_link`, `revoke_access_link`",
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
            [
              "`publish_artifact`",
              "Publish a NEW text-only Artifact (new private_url). Content-only and private. To change published work, use add_revision instead.",
            ],
            [
              "`add_revision`",
              "Revise an EXISTING Artifact: pass its artifact_id to publish a new Revision. Same stable private_url; live-updates open viewers. Use this to change published work, not publish_artifact.",
            ],
            [
              "`multi_edit`",
              "Edit one stored file with literal find/replace, then publish the result as a new Revision under the same Artifact.",
            ],
            ["`list_artifacts`", "List Artifacts in the Workspace."],
            ["`read_artifact`", "Read latest Agent View for an Artifact."],
            [
              "`read_file`",
              "Read one stored file's plaintext body or metadata so an agent can edit against the current bytes.",
            ],
            ["`list_revisions`", "List Revisions for an Artifact."],
            ["`delete_artifact`", "Delete an Artifact."],
            ["`update_display_metadata`", "Update an Artifact display title."],
            [
              "`make_public`",
              "Mint or reuse the Artifact's one Share Link and return its public, no-login Access Link Signed URL.",
            ],
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
          text: "`publish_artifact`, `add_revision`, and `multi_edit` are content-only and private: they take no visibility input and return a single `private_url` (the login-walled `/v/<artifactId>` clean viewer for the Workspace Member), with no `shared` field. To make an Artifact public, call `make_public`; it mints or reuses the one Share Link that follows the latest Revision and returns its public, no-login Access Link Signed URL. To change a published Artifact, call `add_revision` or `multi_edit` with its `artifact_id` rather than `publish_artifact`: the `private_url` is stable and already-open viewers live-update to the new Revision, whereas a second `publish_artifact` mints a separate Artifact on a new link. Artifact IDs, Revision IDs, and content URLs are available through the read/list/link tools. The tools also accept optional idempotency keys; when omitted, the server derives stable keys from the OAuth subject, JSON-RPC id, and tool name.",
        },
        {
          kind: "paragraph",
          text: "Artifact lifetime follows Workspace Auto Deletion policy. MCP callers do not choose TTL.",
        },
      ],
    },
  ],
};
