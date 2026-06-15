import { runPublish } from "@agent-paste/api-client/publish";
import {
  type AgentView,
  type IdempotencyKey,
  type McpAddRevisionInput,
  type McpMultiEditInput,
  mapApiErrorToMcp,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
} from "@agent-paste/contracts";
import { type Edit, ReviseError, reviseOnePath, reviseWholeBody } from "@agent-paste/revise-core";
import type { McpAuthContext } from "./auth.js";
import {
  noopPublishOutput,
  publishViaSharedModule,
  resolveIdempotencyKey,
  shapePublishOutput,
  textPublishInput,
} from "./publish-helpers.js";
import { ForwardError, serviceBindingTransport } from "./publish-transport.js";
import { serviceBindingReader } from "./revision-reader.js";
import type { McpToolDeps, McpToolResult } from "./tool-deps.js";

export async function callAddRevision(
  input: McpAddRevisionInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey("add_revision", input, auth, deps, input.idempotency_key);
  const reader = serviceBindingReader(deps);
  const path = mcpEntrypointForRenderMode(input.render_mode);

  // The verified incremental revise: the engine reads the base, diffs the new body
  // against the stored entrypoint bytes, and publishes a checked patch (or the whole
  // file under the base revision), preserving the artifact's title + tree. It reads the
  // base exactly once and hands it back on a no-op, so there is no second read here.
  let result: Awaited<ReturnType<typeof reviseWholeBody>>;
  try {
    result = await reviseWholeBody(
      { reader, transport: serviceBindingTransport(deps), publish: runPublish },
      {
        artifactId: input.artifact_id,
        path,
        nextText: input.body,
        idempotencyKey,
        // No renderMode: the entrypoint is unchanged, so the mode inherits from the base
        // revision at finalize (ADR 0091 render_mode inheritance invariant).
      },
    );
  } catch (error) {
    // A render_mode that changes the entrypoint (e.g. html -> markdown) has no matching
    // file to patch: fall back to a whole-file publish under the base, still preserving
    // the base title. Every other revise failure maps to an error envelope.
    if (error instanceof ReviseError && error.reason === "path_not_in_base") {
      return addRevisionWithNewEntrypoint(reader, input, idempotencyKey, deps);
    }
    return addRevisionError(error);
  }
  if (result.noop) {
    // Byte-identical body: no revision minted. Echo the stable member viewer link from
    // the base the engine already read, so the agent still gets the link to hand back
    // (the live page already shows this content). Reused stats: nothing was uploaded.
    return noopPublishOutput(result.base);
  }
  return shapePublishOutput(result.outcome);
}

/** Whole-file publish under the base for a revision whose render_mode changes the entrypoint. */
async function addRevisionWithNewEntrypoint(
  reader: ReturnType<typeof serviceBindingReader>,
  input: McpAddRevisionInput,
  idempotencyKey: IdempotencyKey,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  let base: AgentView;
  try {
    base = await reader.readArtifact(input.artifact_id);
  } catch (error) {
    return addRevisionError(error);
  }
  const file = await textPublishInput(input, idempotencyKey, base.title);
  return publishViaSharedModule(deps, { ...file, artifactId: input.artifact_id });
}

/** Map an add_revision throw (forward, revise, or unexpected) to a tool error envelope. */
function addRevisionError(error: unknown): McpToolResult {
  if (error instanceof ForwardError) {
    return { ok: false, error: error.mapped };
  }
  if (error instanceof ReviseError) {
    // A non-matching whole-body revise is an internal fault here, not a client error:
    // add_revision replaces the whole entrypoint, so the only ReviseError reachable is a
    // base that is binary/oversize or a tree that lost the entrypoint mid-flight.
    console.error("mcp: add_revision revise failed", { reason: error.reason });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  console.error("mcp: add_revision failed", { error });
  return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
}

/**
 * Literal find/replace on one stored file, published as a verified patch revise.
 * The engine reads the base, applies the ordered edits, diffs the result, and
 * publishes a checked patch under the base revision — preserving the artifact's
 * title and tree. Unlike add_revision, a non-matching edit here is a CLIENT error
 * (the agent's old_string is stale or ambiguous), so it surfaces as invalid_request
 * with the failing edit index, not internal_error — the agent re-reads and retries.
 */
export async function callMultiEdit(
  input: McpMultiEditInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey("multi_edit", input, auth, deps, input.idempotency_key);
  const edits: Edit[] = input.edits.map((edit) => ({
    oldString: edit.old_string,
    newString: edit.new_string,
    ...(edit.replace_all === true ? { replaceAll: true } : {}),
  }));

  let result: Awaited<ReturnType<typeof reviseOnePath>>;
  try {
    result = await reviseOnePath(
      { reader: serviceBindingReader(deps), transport: serviceBindingTransport(deps), publish: runPublish },
      {
        artifactId: input.artifact_id,
        path: input.path,
        edits,
        idempotencyKey,
        // No renderMode: the entrypoint is unchanged, so the mode inherits from the
        // base revision at finalize (ADR 0091 render_mode inheritance invariant).
      },
    );
  } catch (error) {
    return multiEditError(error);
  }
  if (result.noop) {
    // The edits reproduce the stored bytes: no revision minted. Echo the stable link
    // from the base the engine already read (the live page already shows this content).
    return noopPublishOutput(result.base);
  }
  return shapePublishOutput(result.outcome);
}

/** Map a multi_edit throw to a tool error envelope. A ReviseError is the agent's fault here. */
function multiEditError(error: unknown): McpToolResult {
  if (error instanceof ForwardError) {
    return { ok: false, error: error.mapped };
  }
  if (error instanceof ReviseError) {
    // The edits did not match the base, the path is missing, or the base is not
    // editable text: all caller-correctable. Surface the reason + failing edit index
    // as an application-level invalid_request (HTTP 400) so the agent can re-read and
    // fix, rather than a generic internal_error.
    const detail = error.editIndex === undefined ? error.reason : `${error.reason} (edit ${error.editIndex})`;
    return { ok: false, error: mapApiErrorToMcp({ code: "invalid_request", message: detail }) };
  }
  console.error("mcp: multi_edit failed", { error });
  return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
}
