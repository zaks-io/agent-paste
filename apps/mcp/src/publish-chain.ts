import {
  CreateAccessLinkRequest,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  type IdempotencyKey,
  type McpAddRevisionInput,
  McpListAccessLinksOutput,
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

  let accessLinkUrl: string | undefined;
  if (input.share && shareLinkIdempotencyKey) {
    const shareMinted = await mintShareLinkForPublish(deps, {
      artifactId: finalizeBody.data.artifact_id,
      createIdempotencyKey: shareLinkIdempotencyKey,
      reuseExisting: "artifact_id" in input,
    });
    if (!shareMinted.ok) {
      return shareMinted;
    }
    accessLinkUrl = shareMinted.url;
  }

  const output = McpPublishArtifactOutput.safeParse({
    title: publishResult.data.title,
    ...(accessLinkUrl ? { access_link_url: accessLinkUrl } : {}),
    expires_at: publishResult.data.expires_at,
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
  accessLinkId: string;
};

async function mintShareLinkForPublish(
  deps: PublishChainDeps,
  input: { artifactId: string; createIdempotencyKey: IdempotencyKey; reuseExisting: boolean },
): Promise<{ ok: true; url: string } | ForwardToApiFailure> {
  if (input.reuseExisting) {
    const existing = await findActiveShareLinkId(deps, input.artifactId);
    if (!existing.ok) {
      return existing;
    }
    if (existing.accessLinkId) {
      return mintAccessLink(deps, { accessLinkId: existing.accessLinkId });
    }
  }

  const created = await createShareLink(deps, {
    artifactId: input.artifactId,
    createIdempotencyKey: input.createIdempotencyKey,
  });
  if (!created.ok) {
    return created;
  }
  return mintAccessLink(deps, { accessLinkId: created.accessLinkId });
}

async function findActiveShareLinkId(
  deps: PublishChainDeps,
  artifactId: string,
): Promise<{ ok: true; accessLinkId?: string } | ForwardToApiFailure> {
  const listed = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.list",
    params: { artifact_id: artifactId },
    bearerToken: deps.bearerToken,
  });
  if (!listed.ok) {
    return listed;
  }
  const parsed = McpListAccessLinksOutput.safeParse(listed.body);
  if (!parsed.success) {
    return { ok: false, error: mapInternal() };
  }

  const nowMs = Date.now();
  const activeShare = parsed.data.items.find(
    (link) =>
      link.type === "share" &&
      link.revoked_at === null &&
      (link.expires_at === null || Date.parse(link.expires_at) > nowMs),
  );
  return { ok: true, ...(activeShare ? { accessLinkId: activeShare.id } : {}) };
}

async function createShareLink(
  deps: PublishChainDeps,
  input: { artifactId: string; createIdempotencyKey: IdempotencyKey },
): Promise<{ ok: true; accessLinkId: string } | ForwardToApiFailure> {
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
  return { ok: true, accessLinkId: linkId };
}

async function mintAccessLink(
  deps: PublishChainDeps,
  input: MintAccessLinkInput,
): Promise<{ ok: true; url: string } | ForwardToApiFailure> {
  const minted = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.mint",
    params: { access_link_id: input.accessLinkId },
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
