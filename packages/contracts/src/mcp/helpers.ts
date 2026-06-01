import type { FilePath, IdempotencyKey } from "../primitives.js";
import { IdempotencyKey as IdempotencyKeySchema } from "../primitives.js";
import {
  MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX,
  MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX,
} from "./constants.js";
import type { McpPublishRenderMode } from "./schemas.js";
import type { McpToolName } from "./schemas.js";

/** Derives an access-link create idempotency key from the publish tool key (ADR 0061, AP-84 seam). */
export function mcpPublishAccessLinkIdempotencyKey(
  toolIdempotencyKey: IdempotencyKey,
  kind: "revision" | "share",
): IdempotencyKey {
  const suffix =
    kind === "revision" ? MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX : MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX;
  return IdempotencyKeySchema.parse(`${toolIdempotencyKey}${suffix}`);
}

const MCP_IDEMPOTENCY_SEGMENT_MAX = 64;

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (const unit of text) {
    hash ^= unit.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable, Idempotency-Key-safe segment for token sub or JSON-RPC request id. */
export function mcpIdempotencySegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (
    sanitized.length >= 1 &&
    sanitized.length <= MCP_IDEMPOTENCY_SEGMENT_MAX &&
    /^[A-Za-z0-9._:-]+$/.test(sanitized)
  ) {
    return sanitized;
  }
  return `h${fnv1a32Hex(value)}`;
}

export function deriveMcpIdempotencyKey(input: {
  tokenSub: string;
  jsonRpcId: string | number;
  toolName: McpToolName;
}): IdempotencyKey {
  const sub = mcpIdempotencySegment(input.tokenSub);
  const rpc = mcpIdempotencySegment(String(input.jsonRpcId));
  return IdempotencyKeySchema.parse(`mcp:${sub}:${rpc}:${input.toolName}`);
}

export function mcpEntrypointForRenderMode(renderMode: McpPublishRenderMode): FilePath {
  switch (renderMode) {
    case "html":
      return "index.html" as FilePath;
    case "markdown":
      return "index.md" as FilePath;
    case "text":
      return "content.txt" as FilePath;
  }
}
