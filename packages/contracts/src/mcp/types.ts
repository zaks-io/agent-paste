import type { AppSurface, HttpMethod, IdempotencyRequirement, RouteId } from "../routes.js";
import type { McpToolErrorCode } from "./error-codes.js";
import type { McpScope, McpToolName } from "./schemas.js";
import type { McpToolInputSchemaName, McpToolOutputSchemaName } from "./tool-schemas.js";

/** MCP accepts OAuth bearer tokens only; API keys and dashboard sessions are rejected. */
export type McpAuthRequirement = "mcp_oauth";

export type McpForwardedAuth = "mcp_bearer" | "signed_upload_url";

export type McpForwardedIdempotencyKey = "same_as_tool" | "derived_revision_link" | "derived_share_link";

export type McpForwardedCall = {
  routeId: RouteId;
  auth: McpForwardedAuth;
  idempotencyKey?: McpForwardedIdempotencyKey;
  optional?: boolean;
};

export type McpResolvedForwardedCall = McpForwardedCall & {
  app: AppSurface;
  method: HttpMethod;
  path: string;
  idempotency: IdempotencyRequirement;
};

export type McpToolIdempotency = "none" | "derived" | "optional_override";

export type McpToolContract = {
  name: McpToolName;
  description: string;
  auth: McpAuthRequirement;
  requiredScopes: readonly McpScope[];
  idempotency: McpToolIdempotency;
  inputSchema: McpToolInputSchemaName;
  outputSchema: McpToolOutputSchemaName;
  forwardedCalls: readonly McpForwardedCall[];
  errors: readonly McpToolErrorCode[];
};

export type McpToolListEntry = {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};
