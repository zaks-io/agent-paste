import type { PublishTransport } from "@agent-paste/api-client/publish";
import {
  AgentView,
  AppendUploadFilesResponse,
  ArtifactFileListResponse,
  CompleteUploadFilesResponse,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  type McpMappedToolError,
  mapMcpProtocolError,
  PublishResultV2,
  PublishRevisionResponse,
  UploadSessionTargetsResponse,
} from "@agent-paste/contracts";
import { emitWorkerLog } from "@agent-paste/worker-runtime";
import {
  type ApiServiceBinding,
  type ForwardToApiResult,
  forwardToApiRoute,
  forwardToUploadRoute,
  putSignedUploadFile,
  type UploadServiceBinding,
} from "./forward.js";
import { zodIssueMetadata } from "./zod-issue-metadata.js";

/** Carries a pre-mapped MCP protocol error out of the shared publish module untouched. */
export class ForwardError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;
  constructor(
    readonly mapped: McpMappedToolError,
    meta: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super("mcp forward error");
    this.status = meta.status ?? mapped.httpStatus;
    this.code = mapped.code;
    this.retryAfterSeconds = meta.retryAfterSeconds;
  }
}

export type PublishTransportDeps = {
  api: ApiServiceBinding;
  upload: UploadServiceBinding;
  tokenSub: string;
};

/**
 * MCP transport for the shared publish module. Wraps the service-binding forward
 * helpers. A forward failure already carries the mapped protocol error; this
 * adapter rethrows it as a `ForwardError` so `runPublish`'s plain rejection
 * propagation preserves the exact code. The publish tool handler catches it and
 * rebuilds the `McpToolResult` envelope (see tools.ts).
 */
export function serviceBindingTransport(deps: PublishTransportDeps): PublishTransport {
  return {
    listFiles: (id, query) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: "artifactFiles.list",
        tokenSub: deps.tokenSub,
        params: { artifact_id: id },
        ...(query ? { query } : {}),
      }).then((result) => unwrap(result, ArtifactFileListResponse, "artifactFiles.list")),
    getAgentView: (id, revision) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: revision ? "agentView.getRevision" : "agentView.getLatest",
        tokenSub: deps.tokenSub,
        params: { artifact_id: id, ...(revision ? { revision_id: revision } : {}) },
      }).then((result) => unwrap(result, AgentView, "agentView.getLatest")),
    appendFiles: (id, body, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.appendFiles",
        tokenSub: deps.tokenSub,
        params: { upload_session_id: id },
        body: JSON.stringify(body),
        idempotencyKey: key,
      }).then((result) => unwrap(result, AppendUploadFilesResponse, "uploadSessions.appendFiles")),
    targets: (id, query) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.targets",
        tokenSub: deps.tokenSub,
        params: { upload_session_id: id },
        ...(query ? { query } : {}),
      }).then((result) => unwrap(result, UploadSessionTargetsResponse, "uploadSessions.targets")),
    completeFiles: (id, body, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.completeFiles",
        tokenSub: deps.tokenSub,
        params: { upload_session_id: id },
        body: JSON.stringify(body),
        idempotencyKey: key,
      }).then((result) => unwrap(result, CompleteUploadFilesResponse, "uploadSessions.completeFiles")),
    createUploadSession: (body, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.create",
        tokenSub: deps.tokenSub,
        body: JSON.stringify(body),
        idempotencyKey: key,
      }).then((result) => unwrap(result, CreateUploadSessionResponse, "uploadSessions.create")),

    putFile: async (putUrl, bytes, headers) => {
      const { "content-type": contentType, ...requiredHeaders } = headers;
      const result = await putSignedUploadFile({
        putUrl,
        body: bytes,
        contentType: contentType ?? "application/octet-stream",
        requiredHeaders,
      });
      if (!result.ok) {
        throw new ForwardError(result.error, result);
      }
    },

    finalize: (uploadSessionId, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.finalize",
        params: { upload_session_id: uploadSessionId },
        tokenSub: deps.tokenSub,
        idempotencyKey: key,
      }).then((result) => unwrap(result, FinalizeUploadSessionResponse, "uploadSessions.finalize")),

    publishRevision: (artifactId, revisionId, key, body) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: "revisions.publish",
        params: { artifact_id: artifactId, revision_id: revisionId },
        tokenSub: deps.tokenSub,
        idempotencyKey: key,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).then((result) =>
        unwrap(result, body?.include_retention ? PublishResultV2 : PublishRevisionResponse, "revisions.publish"),
      ),
  };
}

function unwrap<T>(
  result: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  routeId: string,
): T {
  if (!result.ok) {
    throw new ForwardError(result.error, result);
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    // 200 from upstream but the body failed our contract: deploy skew / schema
    // drift. Log loudly — a silent internal_error here is undebuggable in prod.
    // Log only issue metadata, never the raw error: the body can carry PII.
    emitWorkerLog({
      level: "error",
      component: "mcp",
      event: "mcp.publish_forward_response_invalid",
      routeId,
      attributes: { issue_count: zodIssueMetadata(parsed.error)?.length ?? 0 },
    });
    throw new ForwardError(mapMcpProtocolError("internal_error", "internal_error"));
  }
  return parsed.data;
}
