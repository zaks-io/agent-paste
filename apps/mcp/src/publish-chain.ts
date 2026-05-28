import {
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  type IdempotencyKey,
  type McpAddRevisionInput,
  type McpPublishArtifactInput,
  McpPublishArtifactOutput,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  PublishResult,
} from "@agent-paste/contracts";
import type { ApiServiceBinding } from "./forward.js";
import {
  type ForwardToApiFailure,
  type ForwardToApiResult,
  forwardToApiRoute,
  forwardToUploadRoute,
  putSignedUploadFile,
  type UploadServiceBinding,
} from "./forward.js";

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function contentTypeForEntrypoint(path: string): string {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

export type PublishChainDeps = {
  api: ApiServiceBinding;
  upload: UploadServiceBinding;
  bearerToken: string;
  idempotencyKey: IdempotencyKey;
};

export async function runTextPublishChain(
  input: McpPublishArtifactInput | McpAddRevisionInput,
  deps: PublishChainDeps,
): Promise<ForwardToApiResult> {
  const entrypoint = mcpEntrypointForRenderMode(input.render_mode);
  const bodyBytes = new TextEncoder().encode(input.body);
  const createBody = CreateUploadSessionRequest.parse({
    ...("artifact_id" in input ? { artifact_id: input.artifact_id } : {}),
    title: "title" in input ? input.title : "Revision",
    ttl_seconds: DEFAULT_TTL_SECONDS,
    entrypoint,
    files: [{ path: entrypoint, size_bytes: bodyBytes.byteLength }],
  });

  const sessionCreated = await forwardToUploadRoute({
    upload: deps.upload,
    routeId: "uploadSessions.create",
    bearerToken: deps.bearerToken,
    body: JSON.stringify(createBody),
    idempotencyKey: deps.idempotencyKey,
  });
  if (!sessionCreated.ok) {
    return sessionCreated;
  }

  const session = CreateUploadSessionResponse.safeParse(sessionCreated.body);
  if (!session.success) {
    return { ok: false, error: mapInternal() };
  }

  const target = session.data.files.find((file) => file.path === entrypoint);
  if (!target) {
    return { ok: false, error: mapInternal() };
  }

  const uploaded = await putSignedUploadFile({
    putUrl: target.put_url,
    body: bodyBytes,
    contentType: contentTypeForEntrypoint(entrypoint),
    requiredHeaders: target.required_headers,
  });
  if (!uploaded.ok) {
    return uploaded;
  }

  const finalized = await forwardToUploadRoute({
    upload: deps.upload,
    routeId: "uploadSessions.finalize",
    params: { upload_session_id: session.data.upload_session_id },
    bearerToken: deps.bearerToken,
    idempotencyKey: deps.idempotencyKey,
  });
  if (!finalized.ok) {
    return finalized;
  }

  const finalizeBody = FinalizeUploadSessionResponse.safeParse(finalized.body);
  if (!finalizeBody.success) {
    return { ok: false, error: mapInternal() };
  }

  const published = await forwardToApiRoute({
    api: deps.api,
    routeId: "revisions.publish",
    params: { artifact_id: finalizeBody.data.artifact_id, revision_id: finalizeBody.data.revision_id },
    bearerToken: deps.bearerToken,
    idempotencyKey: deps.idempotencyKey,
  });
  if (!published.ok) {
    return published;
  }

  const publishResult = PublishResult.safeParse(published.body);
  if (!publishResult.success) {
    return { ok: false, error: mapInternal() };
  }

  let shareLinkUrl: string | undefined;
  if (input.share) {
    const shareMinted = await mintShareLinkForArtifact(deps, finalizeBody.data.artifact_id);
    if (!shareMinted.ok) {
      return shareMinted;
    }
    shareLinkUrl = shareMinted.url;
  }

  const output = McpPublishArtifactOutput.safeParse({
    ...publishResult.data,
    ...(shareLinkUrl ? { share_link_url: shareLinkUrl } : {}),
  });
  if (!output.success) {
    return { ok: false, error: mapInternal() };
  }

  return { ok: true, status: 200, body: output.data };
}

async function mintShareLinkForArtifact(
  deps: PublishChainDeps,
  artifactId: string,
): Promise<{ ok: true; url: string } | ForwardToApiFailure> {
  const created = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.create",
    params: { artifact_id: artifactId },
    bearerToken: deps.bearerToken,
    idempotencyKey: deps.idempotencyKey,
    body: JSON.stringify({ type: "share" }),
  });
  if (!created.ok) {
    return created;
  }
  const linkId =
    created.body && typeof created.body === "object" && "id" in created.body && typeof created.body.id === "string"
      ? created.body.id
      : null;
  if (!linkId) {
    return { ok: false, error: mapInternal() };
  }

  const minted = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.mint",
    params: { access_link_id: linkId },
    bearerToken: deps.bearerToken,
  });
  if (!minted.ok) {
    return minted;
  }
  const url =
    minted.body && typeof minted.body === "object" && "url" in minted.body && typeof minted.body.url === "string"
      ? minted.body.url
      : null;
  if (!url) {
    return { ok: false, error: mapInternal() };
  }
  return { ok: true, url };
}

function mapInternal() {
  return mapMcpProtocolError("internal_error", "internal_error");
}
