import type { FilePath, IdempotencyKey } from "../primitives.js";
import { IdempotencyKey as IdempotencyKeySchema } from "../primitives.js";
import { MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX } from "./constants.js";
import type { McpPublishRenderMode, McpToolName } from "./schemas.js";

/** Reserved for hashed idempotency encodings; direct keys with this shape are re-hashed to stay disjoint (AP-201). */
const MCP_HASHED_IDEMPOTENCY_BASE = /^h[0-9a-f]{32}$/;

/** Derives the optional share-link create idempotency key from a publish key. */
export function publishShareLinkIdempotencyKey(publishIdempotencyKey: string): IdempotencyKey {
  const suffix = MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX;
  const direct = `${publishIdempotencyKey}${suffix}`;
  const directIsSafe = IdempotencyKeySchema.safeParse(direct).success;
  if (directIsSafe && !MCP_HASHED_IDEMPOTENCY_BASE.test(publishIdempotencyKey)) {
    return IdempotencyKeySchema.parse(direct);
  }
  const hashedBase = `h${fnv1a128Hex(publishIdempotencyKey)}`;
  return IdempotencyKeySchema.parse(`${hashedBase}${suffix}`);
}

/** Derives the optional share-link create idempotency key from the publish tool key. */
export function mcpPublishAccessLinkIdempotencyKey(toolIdempotencyKey: IdempotencyKey): IdempotencyKey {
  return publishShareLinkIdempotencyKey(toolIdempotencyKey);
}

const MCP_IDEMPOTENCY_SEGMENT_MAX = 64;

const FNV_128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_128_PRIME = 0x0000000001000000000000000000013bn;
const FNV_128_MASK = (1n << 128n) - 1n;

/**
 * 128-bit FNV-1a as 32 lowercase hex chars. The idempotency key is namespaced by
 * token sub, so collisions can only occur against the same actor's own payloads
 * (not adversarially), which makes a wide non-cryptographic digest sufficient and
 * keeps this module synchronous and dependency-free. 128 bits drops the birthday
 * collision risk far below any realistic per-actor call volume — the prior 32-bit
 * digest collided two distinct payloads at ~1-in-4-billion and silently replayed
 * the first, dropping the second edit behind a success envelope (AP-375).
 */
function fnv1a128Hex(text: string): string {
  let hash = FNV_128_OFFSET;
  for (const unit of text) {
    hash ^= BigInt(unit.codePointAt(0) ?? 0);
    hash = (hash * FNV_128_PRIME) & FNV_128_MASK;
  }
  return hash.toString(16).padStart(32, "0");
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
  return `h${fnv1a128Hex(value)}`;
}

/** Canonical JSON (recursively sorted object keys) so deterministic retries hash identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function deriveMcpIdempotencyKey(input: {
  tokenSub: string;
  jsonRpcId: string | number;
  toolName: McpToolName;
  /** Tool arguments; MCP clients reuse JSON-RPC ids across sessions, so the key must carry payload identity (AP bug: stale publish replay). */
  toolArgs: Record<string, unknown> | undefined;
}): IdempotencyKey {
  const sub = mcpIdempotencySegment(input.tokenSub);
  const rpc = mcpIdempotencySegment(String(input.jsonRpcId));
  const args = `h${fnv1a128Hex(canonicalJson(input.toolArgs ?? {}))}`;
  return IdempotencyKeySchema.parse(`mcp:${sub}:${rpc}:${input.toolName}:${args}`);
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
