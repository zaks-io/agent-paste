import { runPublish } from "@agent-paste/api-client/publish";
import {
  type McpAddRevisionInput,
  type McpMultiEditInput,
  mapApiErrorToMcp,
  mapMcpProtocolError,
} from "@agent-paste/contracts";
import { type Edit, ReviseError, reviseOnePath } from "@agent-paste/revise-core";
import { captureWorkerError, emitWorkerLog } from "@agent-paste/worker-runtime";
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
  try {
    const base = await serviceBindingReader(deps).readArtifact(input.artifact_id);
    const payload = await textPublishInput(input, idempotencyKey, base.title);
    const path = payload.entrypoint;
    const old = base.files.find((file) => file.path === path);
    if (!old && base.files_truncated) {
      return {
        ok: false,
        error: mapApiErrorToMcp({
          code: "invalid_request",
          message: "File listing is truncated. Use CLI publish --to for this update.",
        }),
      };
    }
    if (old?.sha256 === payload.files[0]?.sha256 && base.entrypoint === path && input.pin === undefined)
      return noopPublishOutput(base);
    if (old && !old.sha256)
      return {
        ok: false,
        error: mapApiErrorToMcp({
          code: "invalid_request",
          message: "Legacy file has no digest. Use an explicit full-tree CLI mirror.",
        }),
      };
    return publishViaSharedModule(deps, {
      ...payload,
      artifactId: base.artifact_id,
      commit: { guard: "paths", ...(input.pin !== undefined ? { pin: input.pin } : {}) },
      files: payload.files.map((file) => ({
        ...file,
        expect: old ? { sha256: old.sha256!, size_bytes: old.size_bytes } : { absent: true },
      })),
    });
  } catch (error) {
    return addRevisionError(error);
  }
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
    emitWorkerLog({
      level: "error",
      component: "mcp",
      event: "mcp.add_revision_revise_failed",
      attributes: { reason: error.reason },
    });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  captureWorkerError({ component: "mcp", event: "mcp.add_revision_failed", error });
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
  captureWorkerError({ component: "mcp", event: "mcp.multi_edit_failed", error });
  return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
}
