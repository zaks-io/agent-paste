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
      "Publish a NEW text-only Artifact: creates a new Artifact with its own private_url, a login-walled browser viewer you hand to the user. Publish is content-only and private; there is no visibility or share param. Use this only for something not yet published. To CHANGE something you already published, do NOT call this again. Call add_revision with the existing artifact_id instead, so the user's open private_url live-updates in place. Re-publishing an edit here mints a different Artifact on a different link and strands the page the user already has open. To make an Artifact reachable without login, call set_visibility with visibility: 'unlisted', which returns unlisted_url. The publish response intentionally omits artifact_id, revision_id, content URLs, and Agent View URLs; recover the Artifact ID with list_artifacts (data[].id), then use read_artifact, read_file, list_revisions, or link tools for follow-up details.",
    auth: "mcp_oauth",
    requiredScopes: ["publish", "read"],
    idempotency: "optional_override",
    inputSchema: "publish_artifact",
    outputSchema: "publish_artifact",
    forwardedCalls: publishChainBaseForwardedCalls,
    errors: publishChainErrors,
  },
  {
    name: "add_revision",
    description:
      "Edit/update an EXISTING Artifact: adds and publishes a new Revision under the artifact_id you pass. This is how you change something already published. The Artifact's private_url is STABLE and already-open viewers LIVE-UPDATE to this new Revision; there is no new link to send. Content-only and private: there is no visibility or share param. Use this, NOT publish_artifact, whenever the user wants to revise, fix, or extend work you already published; calling publish_artifact instead would create a separate Artifact on a new link and strand the page the user already has open. The response intentionally omits IDs and content URLs; get artifact_id from list_artifacts (data[].id) when needed, and use read_artifact, read_file, list_revisions, or link tools for follow-up details. To make an Artifact reachable without login, call set_visibility with visibility: 'unlisted'.",
    auth: "mcp_oauth",
    requiredScopes: ["publish", "read"],
    idempotency: "optional_override",
    inputSchema: "add_revision",
    outputSchema: "add_revision",
    forwardedCalls: publishChainBaseForwardedCalls,
    errors: publishChainErrors,
  },
  {
    name: "multi_edit",
    description:
      "Edit one file inside an EXISTING Artifact with literal find/replace, the same {old_string, new_string} model as Claude's Edit tool, then publish the result as a new Revision under the artifact_id. Use this to make a targeted change without resending the whole file: read the file first with read_file, then send ordered edits whose old_string matches the current bytes exactly. Each old_string must occur once (set replace_all to change every occurrence); a miss or an ambiguous match fails loud so you re-read and retry. The server never guesses. The Artifact's private_url is STABLE and already-open viewers LIVE-UPDATE to the new Revision; there is no new link to send. Content-only and PRIVATE. An edit set that reproduces the current bytes is a no-op and mints no Revision. Get the artifact_id from list_artifacts (data[].id) or read_artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["publish", "read"],
    idempotency: "optional_override",
    inputSchema: "multi_edit",
    outputSchema: "multi_edit",
    // Reads the base (agent-view + file-content) on the client, then runs the same
    // content-only upload->publish chain as the other publish tools. read group +
    // storage_unavailable because it decrypts a blob to apply the edits, like read_file.
    forwardedCalls: [
      {
        routeId: "agentView.getLatest",
        auth: "mcp_bearer",
      },
      {
        routeId: "artifacts.fileContent",
        auth: "mcp_bearer",
      },
      ...publishChainBaseForwardedCalls,
    ],
    errors: [...publishChainErrors, ...readErrors, "storage_unavailable"] as const,
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
    name: "read_file",
    description:
      "Read one file's stored content from an Artifact so you can edit it and revise. Returns the decoded text body plus its sha256 for text files up to 10 MiB; for binary or larger files it returns sha256/size/is_binary with no body (fetch those via the file url or re-upload whole). Use the returned body as the base when producing an edited Revision; the sha256 is the exact base the server validates a diff against.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "read_file",
    outputSchema: "read_file",
    forwardedCalls: [
      {
        routeId: "artifacts.fileContent",
        auth: "mcp_bearer",
      },
    ],
    // read group + storage_unavailable: reading a file decrypts a blob, which the
    // base read tools never do, so this tool can surface a transient blob-read
    // failure the others cannot. Declared so the MCP forward maps it to 503
    // instead of the 500 fallback.
    errors: [...readErrors, "storage_unavailable"] as const,
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
    requiredScopes: ["publish"],
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
    requiredScopes: ["publish"],
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
    name: "set_visibility",
    description:
      "Set Artifact visibility. Use private to revoke all active Access Links and return private_url. Use unlisted to create or reuse the revocable Share Link and return unlisted_url for no-login handoff.",
    auth: "mcp_oauth",
    requiredScopes: ["publish", "read"],
    idempotency: "derived",
    inputSchema: "set_visibility",
    outputSchema: "set_visibility",
    forwardedCalls: [
      {
        routeId: "agentView.getLatest",
        auth: "mcp_bearer",
      },
      {
        routeId: "accessLinks.list",
        auth: "mcp_bearer",
      },
      {
        routeId: "accessLinks.revoke",
        auth: "mcp_bearer",
      },
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
    errors: [...shareLinkErrors, ...readErrors] as const,
  },
  {
    name: "create_revision_link",
    description:
      "Create and mint a snapshot Access Link for one specific Revision. Use only when the user explicitly asks for a fixed Revision, not for the live page.",
    auth: "mcp_oauth",
    requiredScopes: ["publish", "read"],
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
    requiredScopes: ["publish", "read"],
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
    requiredScopes: ["publish"],
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
