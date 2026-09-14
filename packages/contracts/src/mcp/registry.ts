import { mcpToolErrorGroups } from "./error-codes.js";
import type { McpForwardedCall, McpToolContract } from "./types.js";

const { publishChain: publishChainErrors, read: readErrors } = mcpToolErrorGroups;

const publishChainBaseForwardedCalls = [
  {
    routeId: "uploadSessions.create",
    auth: "mcp_principal",
    idempotencyKey: "same_as_tool",
  },
  {
    routeId: "uploadSessions.putFile",
    auth: "signed_upload_url",
  },
  {
    routeId: "uploadSessions.finalize",
    auth: "mcp_principal",
    idempotencyKey: "same_as_tool",
  },
  {
    routeId: "revisions.publish",
    auth: "mcp_principal",
    idempotencyKey: "same_as_tool",
  },
] as const satisfies readonly McpForwardedCall[];

export const mcpToolContracts = [
  {
    name: "publish_artifact",
    description:
      "Publish a NEW text Artifact. Returns artifact_id, revision_id, and url, which opens without login and stays the same across Revisions. To change an existing Artifact use add_revision or multi_edit; publishing an edit here creates a second Artifact at a second URL.",
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
      "Publish a new body for an existing Artifact. artifact_id accepts the ID or the full URL. Returns the same url now showing the new Revision. Keeps the title; a body identical to the stored bytes is a no-op and mints no Revision.",
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
      "Literal find/replace in one file of an existing Artifact, published as a new Revision at the same url. Call read_file first. Each old_string must match exactly once unless replace_all is set; a miss or ambiguous match fails with invalid_request naming the edit index. A no-op mints no Revision.",
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
        auth: "mcp_principal",
      },
      {
        routeId: "artifacts.fileContent",
        auth: "mcp_principal",
      },
      ...publishChainBaseForwardedCalls,
    ],
    errors: [...publishChainErrors, ...readErrors, "storage_unavailable"] as const,
  },
  {
    name: "list_artifacts",
    description: "List Artifacts in the Workspace. Returns data[]; use data[].id as artifact_id.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_artifacts",
    outputSchema: "list_artifacts",
    forwardedCalls: [
      {
        routeId: "artifacts.list",
        auth: "mcp_principal",
      },
    ],
    errors: readErrors,
  },
  {
    name: "read_artifact",
    description:
      "Read an Artifact's latest Agent View. Returns artifact_id, revision_id, files[].url, and optional bundle metadata. File contents are not inlined; use read_file.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "read_artifact",
    outputSchema: "read_artifact",
    forwardedCalls: [
      {
        routeId: "agentView.getLatest",
        auth: "mcp_principal",
      },
    ],
    errors: readErrors,
  },
  {
    name: "read_file",
    description:
      "Read one stored file so you can edit it. Returns the text body and its sha256 for text files up to 10 MiB; binary or larger files return sha256, size, and is_binary with no body (fetch them from the file url).",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "read_file",
    outputSchema: "read_file",
    forwardedCalls: [
      {
        routeId: "artifacts.fileContent",
        auth: "mcp_principal",
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
      "List an Artifact's Revisions. Returns items[]; use items[].revision_id where a Revision ID is needed.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_revisions",
    outputSchema: "list_revisions",
    forwardedCalls: [
      {
        routeId: "revisions.list",
        auth: "mcp_principal",
      },
    ],
    errors: readErrors,
  },
  {
    name: "delete_artifact",
    description: "Delete an Artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["publish"],
    idempotency: "none",
    inputSchema: "delete_artifact",
    outputSchema: "delete_artifact",
    forwardedCalls: [
      {
        routeId: "artifacts.delete",
        auth: "mcp_principal",
      },
    ],
    errors: ["forbidden", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "update_display_metadata",
    description: "Set an Artifact's title.",
    auth: "mcp_oauth",
    requiredScopes: ["publish"],
    idempotency: "none",
    inputSchema: "update_display_metadata",
    outputSchema: "update_display_metadata",
    forwardedCalls: [
      {
        routeId: "artifacts.updateDisplayMetadata",
        auth: "mcp_principal",
      },
    ],
    errors: ["forbidden", "invalid_request", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "whoami",
    description: "Return the authenticated member, Workspace, and MCP scopes.",
    auth: "mcp_oauth",
    requiredScopes: [],
    idempotency: "none",
    inputSchema: "whoami",
    outputSchema: "whoami",
    forwardedCalls: [
      {
        routeId: "mcp.whoami",
        auth: "mcp_principal",
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
