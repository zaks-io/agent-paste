import {
  CreateAccessLinkRequest,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  type IdempotencyKey,
  type McpAddRevisionInput,
  type McpPublishArtifactInput,
  McpPublishArtifactOutput,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  mcpPublishAccessLinkIdempotencyKey,
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
  const shareLinkIdempotencyKey =
    input.share === true ? mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey) : undefined;

  const entrypoint = mcpEntrypointForRenderMode(input.render_mode);
  const bodyBytes = new TextEncoder().encode(input.body);
  const sha256 = await sha256Hex(bodyBytes);
  // TTL is a server-side policy decision derived from the workspace tier (ephemeral
  // workspaces are hard-capped at one day). Clients cannot request or influence it.
  const createBody = CreateUploadSessionRequest.parse({
    ...("artifact_id" in input ? { artifact_id: input.artifact_id } : {}),
    title: "title" in input ? input.title : "Revision",
    entrypoint,
    files: [{ path: entrypoint, size_bytes: bodyBytes.byteLength, sha256 }],
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

  if (target.status === "upload_required") {
    const uploaded = await putSignedUploadFile({
      putUrl: target.put_url,
      body: bodyBytes,
      contentType: contentTypeForEntrypoint(entrypoint),
      requiredHeaders: target.required_headers,
    });
    if (!uploaded.ok) {
      return uploaded;
    }
  }
  const uploadStats = {
    total_files: session.data.files.length,
    total_bytes: bodyBytes.byteLength,
    uploaded_files: target.status === "upload_required" ? 1 : 0,
    uploaded_bytes: target.status === "upload_required" ? bodyBytes.byteLength : 0,
    reused_files: target.status === "reused" ? 1 : 0,
    reused_bytes: target.status === "reused" ? bodyBytes.byteLength : 0,
  };

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
  if (input.share && shareLinkIdempotencyKey) {
    const shareMinted = await mintAccessLink(deps, {
      artifactId: finalizeBody.data.artifact_id,
      createIdempotencyKey: shareLinkIdempotencyKey,
    });
    if (!shareMinted.ok) {
      return shareMinted;
    }
    shareLinkUrl = shareMinted.url;
  }

  const output = McpPublishArtifactOutput.safeParse({
    ...publishResult.data,
    ...(shareLinkUrl ? { share_link_url: shareLinkUrl } : {}),
    upload_stats: uploadStats,
  });
  if (!output.success) {
    return { ok: false, error: mapInternal() };
  }

  return { ok: true, status: 200, body: output.data };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type MintAccessLinkInput = {
  artifactId: string;
  createIdempotencyKey: IdempotencyKey;
};

async function mintAccessLink(
  deps: PublishChainDeps,
  input: MintAccessLinkInput,
): Promise<{ ok: true; url: string } | ForwardToApiFailure> {
  const createBody = CreateAccessLinkRequest.parse({ type: "share" as const });

  const created = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.create",
    params: { artifact_id: input.artifactId },
    bearerToken: deps.bearerToken,
    idempotencyKey: input.createIdempotencyKey,
    body: JSON.stringify(createBody),
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
