import { type PublishFile, type PublishInput, type PublishOutcome, runPublish } from "@agent-paste/api-client/publish";
import {
  deriveMcpIdempotencyKey,
  type IdempotencyKey,
  McpPublishArtifactOutput,
  type McpPublishRenderMode,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
} from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { ForwardError, serviceBindingTransport } from "./publish-transport.js";
import type { McpToolDeps, McpToolResult } from "./tool-deps.js";
import { zodIssueMetadata } from "./zod-issue-metadata.js";

/**
 * MCP idempotency key resolution (shared by the direct-publish and revise tools).
 * An explicit key always wins; otherwise it is a pure function of the tool args
 * so a retried call collapses onto the same revision.
 */
export function resolveIdempotencyKey(
  toolName: Parameters<typeof deriveMcpIdempotencyKey>[0]["toolName"],
  toolArgs: Record<string, unknown>,
  auth: McpAuthContext,
  deps: McpToolDeps,
  explicit?: string,
): IdempotencyKey {
  if (explicit) {
    return explicit as IdempotencyKey;
  }
  return deriveMcpIdempotencyKey({
    tokenSub: auth.tokenSub,
    jsonRpcId: deps.jsonRpcId,
    toolName,
    toolArgs,
  });
}

/** Run the shared publish module and shape the result into the MCP output, preserving mapped errors. */
export async function publishViaSharedModule(deps: McpToolDeps, input: PublishInput): Promise<McpToolResult> {
  let outcome: PublishOutcome;
  try {
    outcome = await runPublish(serviceBindingTransport(deps), input);
  } catch (error) {
    if (error instanceof ForwardError) {
      return { ok: false, error: error.mapped };
    }
    // Any other throw (e.g. the shared module's "unknown file" guard) is an
    // internal fault: map it to a JSON-RPC internal_error so the client gets a
    // correlated envelope, never an uncaught HTTP 500.
    console.error("mcp: publish failed", { error });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return shapePublishOutput(outcome);
}

/** Shape a publish outcome (or a no-op echo) into the MCP publish output envelope. */
export function shapePublishOutput(
  outcome: Pick<PublishOutcome, "title" | "privateUrl" | "expiresAt" | "uploadStats">,
): McpToolResult {
  if (!outcome.privateUrl) {
    console.error("mcp: publish output missing private_url");
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  const parsed = McpPublishArtifactOutput.safeParse({
    title: outcome.title,
    private_url: outcome.privateUrl,
    expires_at: outcome.expiresAt,
    upload_stats: {
      total_files: outcome.uploadStats.totalFiles,
      total_bytes: outcome.uploadStats.totalBytes,
      uploaded_files: outcome.uploadStats.uploadedFiles,
      uploaded_bytes: outcome.uploadStats.uploadedBytes,
      reused_files: outcome.uploadStats.reusedFiles,
      reused_bytes: outcome.uploadStats.reusedBytes,
    },
  });
  if (!parsed.success) {
    // Log only issue metadata, never the raw error — the publish outcome can
    // carry artifact content/PII. Same rule as parseForwardResult.
    console.error("mcp: publish output schema validation failed", {
      issues: zodIssueMetadata(parsed.error),
    });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, result: parsed.data };
}

/** A no-op revise echoes the base link/title/expiry with all-zero upload stats. */
export function noopPublishOutput(base: {
  title: string;
  private_url: string;
  expires_at: PublishOutcome["expiresAt"];
}): McpToolResult {
  return shapePublishOutput({
    title: base.title,
    privateUrl: base.private_url,
    expiresAt: base.expires_at,
    uploadStats: { totalFiles: 0, totalBytes: 0, uploadedFiles: 0, uploadedBytes: 0, reusedFiles: 0, reusedBytes: 0 },
  });
}

/**
 * Build the single-file PublishInput from an MCP text-publish request. `baseTitle`
 * is the existing artifact's title for the add_revision path: a revision has no title
 * field, so it preserves the base title instead of overwriting it. `"Revision"` is the
 * last-resort fallback only when there is neither an explicit title nor a base.
 */
export async function textPublishInput(
  input: { title?: string; body: string; render_mode: McpPublishRenderMode },
  idempotencyKey: IdempotencyKey,
  baseTitle?: string,
): Promise<PublishInput> {
  const entrypoint = mcpEntrypointForRenderMode(input.render_mode);
  const bytes = new TextEncoder().encode(input.body);
  const sha256 = await sha256Hex(bytes);
  const file: PublishFile = {
    path: entrypoint,
    sizeBytes: bytes.byteLength,
    sha256: sha256 as PublishFile["sha256"],
    contentType: contentTypeForEntrypoint(entrypoint),
    read: () => bytes,
  };
  const title = ("title" in input && input.title ? input.title : (baseTitle ?? "Revision")) as PublishInput["title"];
  return {
    files: [file],
    title,
    entrypoint,
    idempotencyKey,
  };
}

function contentTypeForEntrypoint(path: string): string {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
