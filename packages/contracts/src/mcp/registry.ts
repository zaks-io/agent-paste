import { mcpToolErrorGroups } from "./error-codes.js";
import type { McpForwardedCall, McpToolContract } from "./types.js";

const { publishChain: publishChainErrors, read: readErrors, shareLink: shareLinkErrors } = mcpToolErrorGroups;

const publishChainBaseForwardedCalls = [
  {
    routeId: "uploadSessions.create",
    auth: "mcp_bearer",
    idempotencyKey: "same_as_tool",
  },
  {
    routeId: "uploadSessions.putFile",
    auth: "signed_upload_url",
  },
  {
    routeId: "uploadSessions.finalize",
    auth: "mcp_bearer",
    idempotencyKey: "same_as_tool",
  },
  {
    routeId: "revisions.publish",
    auth: "mcp_bearer",
    idempotencyKey: "same_as_tool",
  },
] as const satisfies readonly McpForwardedCall[];

export const mcpToolContracts = [
  {
    name: "publish_artifact",
    description:
      "Publish a NEW text-only Artifact: creates a new Artifact with its own viewer_url, the browser link you hand to the user. Use this only for something not yet published. To CHANGE something you already published, do NOT call this again — call add_revision with the existing artifact_id instead, so the user's open viewer_url live-updates in place. Re-publishing an edit here mints a different Artifact on a different link and strands the page the user already has open. Private by default (viewer_url is the authenticated owner-only link); set share:true and viewer_url becomes the public Share Link anyone can open. Keep the artifact_id from the response so you can revise later; IDs and content URLs are also available via the read/list/link tools.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read"],
    idempotency: "optional_override",
    inputSchema: "publish_artifact",
    outputSchema: "publish_artifact",
    forwardedCalls: publishChainBaseForwardedCalls,
    errors: publishChainErrors,
  },
  {
    name: "add_revision",
    description:
      "Edit/update an EXISTING Artifact: adds and publishes a new Revision under the artifact_id you pass. This is how you change something already published. The Artifact's viewer_url / Share Link is STABLE and already-open viewers LIVE-UPDATE to this new Revision — there is no new link to send. Use this, NOT publish_artifact, whenever the user wants to revise, fix, or extend work you already published; calling publish_artifact instead would create a separate Artifact on a new link and strand the page the user already has open. Get the artifact_id from the publish_artifact response or list_artifacts. Private by default; set share:true to share. IDs and content URLs are also available via the read/list/link tools.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read"],
    idempotency: "optional_override",
    inputSchema: "add_revision",
    outputSchema: "add_revision",
    forwardedCalls: publishChainBaseForwardedCalls,
    errors: publishChainErrors,
  },
  {
    name: "list_artifacts",
    description: "List artifacts in the authenticated workspace.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_artifacts",
    outputSchema: "list_artifacts",
    forwardedCalls: [
      {
        routeId: "artifacts.list",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "read_artifact",
    description: "Read the latest Agent View for an artifact without inlining file bytes.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "read_artifact",
    outputSchema: "read_artifact",
    forwardedCalls: [
      {
        routeId: "agentView.getLatest",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "list_revisions",
    description: "List revisions for an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_revisions",
    outputSchema: "list_revisions",
    forwardedCalls: [
      {
        routeId: "revisions.list",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "delete_artifact",
    description: "Delete an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["write"],
    idempotency: "none",
    inputSchema: "delete_artifact",
    outputSchema: "delete_artifact",
    forwardedCalls: [
      {
        routeId: "artifacts.delete",
        auth: "mcp_bearer",
      },
    ],
    errors: ["forbidden", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "update_display_metadata",
    description: "Update artifact display title (description updates are not supported in this phase).",
    auth: "mcp_oauth",
    requiredScopes: ["write"],
    idempotency: "none",
    inputSchema: "update_display_metadata",
    outputSchema: "update_display_metadata",
    forwardedCalls: [
      {
        routeId: "artifacts.updateDisplayMetadata",
        auth: "mcp_bearer",
      },
    ],
    errors: ["forbidden", "invalid_request", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "create_share_link",
    description:
      "Create a Share Link and mint its Access Link Signed URL. This is the link to give users when they ask for the live page; it follows the latest Published Revision.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "derived",
    inputSchema: "create_share_link",
    outputSchema: "create_share_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "create_revision_link",
    description:
      "Create and mint a snapshot Access Link for one specific Revision. Use only when the user explicitly asks for a fixed Revision, not for the live page.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "derived",
    inputSchema: "create_revision_link",
    outputSchema: "create_revision_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "list_access_links",
    description: "List Share Links and Revision Links for an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "none",
    inputSchema: "list_access_links",
    outputSchema: "list_access_links",
    forwardedCalls: [
      {
        routeId: "accessLinks.list",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "revoke_access_link",
    description: "Revoke a Share Link or Revision Link.",
    auth: "mcp_oauth",
    requiredScopes: ["share"],
    idempotency: "none",
    inputSchema: "revoke_access_link",
    outputSchema: "revoke_access_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.revoke",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "whoami",
    description: "Return the authenticated workspace member, workspace, and granted MCP scopes.",
    auth: "mcp_oauth",
    requiredScopes: [],
    idempotency: "none",
    inputSchema: "whoami",
    outputSchema: "whoami",
    forwardedCalls: [
      {
        routeId: "mcp.whoami",
        auth: "mcp_bearer",
      },
    ],
    errors: ["database_unavailable"] as const,
  },
] as const satisfies readonly McpToolContract[];

export function mcpToolContractByName(name: McpToolContract["name"]): McpToolContract {
  const contract = mcpToolContracts.find((entry) => entry.name === name);
  if (!contract) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  return contract;
}
