import type { PublishTransport } from "@agent-paste/api-client/publish";
import {
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  type McpMappedToolError,
  mapMcpProtocolError,
  PublishResult,
} from "@agent-paste/contracts";
import {
  type ApiServiceBinding,
  type ForwardToApiResult,
  forwardToApiRoute,
  forwardToUploadRoute,
  putSignedUploadFile,
  type UploadServiceBinding,
} from "./forward.js";

/** Carries a pre-mapped MCP protocol error out of the shared publish module untouched. */
export class ForwardError extends Error {
  constructor(readonly mapped: McpMappedToolError) {
    super("mcp forward error");
  }
}

export type PublishTransportDeps = {
  api: ApiServiceBinding;
  upload: UploadServiceBinding;
  bearerToken: string;
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
    createUploadSession: (body, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.create",
        bearerToken: deps.bearerToken,
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
        throw new ForwardError(result.error);
      }
    },

    finalize: (uploadSessionId, key) =>
      forwardToUploadRoute({
        upload: deps.upload,
        routeId: "uploadSessions.finalize",
        params: { upload_session_id: uploadSessionId },
        bearerToken: deps.bearerToken,
        idempotencyKey: key,
      }).then((result) => unwrap(result, FinalizeUploadSessionResponse, "uploadSessions.finalize")),

    publishRevision: (artifactId, revisionId, key, body) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: "revisions.publish",
        params: { artifact_id: artifactId, revision_id: revisionId },
        bearerToken: deps.bearerToken,
        idempotencyKey: key,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).then((result) => unwrap(result, PublishResult, "revisions.publish")),
  };
}

function unwrap<T>(
  result: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  routeId: string,
): T {
  if (!result.ok) {
    throw new ForwardError(result.error);
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    // 200 from upstream but the body failed our contract: deploy skew / schema
    // drift. Log loudly — a silent internal_error here is undebuggable in prod.
    console.error("mcp: publish forward response schema validation failed", { routeId, error: parsed.error });
    throw new ForwardError(mapMcpProtocolError("internal_error", "internal_error"));
  }
  return parsed.data;
}
