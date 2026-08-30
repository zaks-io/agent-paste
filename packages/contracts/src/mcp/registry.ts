import { mcpToolErrorGroups } from "./error-codes.js";
import type { McpForwardedCall, McpToolContract } from "./types.js";

const { publishChain: publishChainErrors, read: readErrors } = mcpToolErrorGroups;

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
      "Publish a NEW text-only Artifact and return artifact_id, revision_id, and its top-level url. The URL is an unguessable capability, opens without login, and stays stable across revisions. Use this only for something not yet published. To CHANGE an existing Artifact, call add_revision with the returned artifact_id instead. Publishing an edit here creates a different Artifact on a different URL.",
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
      "Edit/update an EXISTING Artifact by publishing a new Revision under artifact_id. The response returns that artifact_id, the new revision_id, and the stable url. The URL shows the newest Revision on refresh, so there is no new link to send. Use this, not publish_artifact, whenever the user wants to revise, fix, or extend existing work.",
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
      "Edit one file inside an EXISTING Artifact with literal find/replace, then publish the result as a new Revision. Read the file first with read_file. Each old_string must match exactly once unless replace_all is set; misses and ambiguous matches fail loud. The Artifact's url stays stable and shows the newest Revision on refresh. A no-op mints no Revision.",
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
    description: "List Artifacts in the authenticated workspace. Returns data[]; use data[].id as artifact_id.",
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
    description:
      "Read the latest Agent View for an Artifact after you know artifact_id; returns artifact_id, revision_id, files[].url, and optional bundle metadata without inlining file bytes.",
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
    description:
      "List Revisions for an Artifact. Returns items[]; use items[].revision_id when another tool needs a Revision ID.",
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
