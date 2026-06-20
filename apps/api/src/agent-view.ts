import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import { bundleKeyFor, storageEnvSegment } from "@agent-paste/db";
import { resolveAgentViewTokenSigner, resolveContentTokenSigner } from "@agent-paste/rotation";
import { type AgentViewTokenPayload, mintAgentViewUrl } from "@agent-paste/tokens/agent-view";
import { mintBundleUrl, mintContentUrl } from "@agent-paste/tokens/content";
import type { Env } from "./env.js";
import { apiBaseUrl, contentBaseUrl, webBaseUrl } from "./runtime.js";

export async function verifyAgentViewTokenForEnv(token: string, env: Env): Promise<AgentViewTokenPayload | null> {
  const signer = resolveAgentViewTokenSigner(env);
  return signer ? signer.verify(token) : null;
}

type AgentViewRecord = {
  workspace_id?: unknown;
  artifact_id?: unknown;
  revision_id?: unknown;
  entrypoint?: unknown;
  render_mode?: unknown;
  expires_at?: unknown;
  revision_content_url?: unknown;
  ephemeral_tier?: unknown;
  bundle?: { status?: unknown; url?: unknown } & Record<string, unknown>;
  files?: Array<{ path?: unknown; url?: unknown; object_key?: unknown } & Record<string, unknown>>;
};

type ContentSigningAuth = {
  accessLinkId?: string;
  workspaceId?: string;
  noindex?: boolean;
  scriptDisabled?: boolean;
};

function stripInternalAgentViewFields(
  data: AgentViewRecord,
): Omit<AgentViewRecord, "workspace_id" | "revision_content_url" | "render_mode"> {
  const {
    workspace_id: _internalWorkspaceId,
    revision_content_url: _rawRevisionContentUrl,
    render_mode: _internalRenderMode,
    ...publicFields
  } = data;
  return publicFields;
}

function resolveSigningWorkspaceId(
  internalWorkspaceId: unknown,
  options?: { workspaceId?: string },
): string | undefined {
  return options?.workspaceId ?? (typeof internalWorkspaceId === "string" ? internalWorkspaceId : undefined);
}

function isEphemeralAgentView(data: AgentViewRecord, options?: { ephemeralTier?: boolean }): boolean {
  return options?.ephemeralTier === true || ("ephemeral_tier" in data && data.ephemeral_tier === true);
}

function buildContentSigningAuth(
  options: { accessLinkId?: string } | undefined,
  workspaceId: string | undefined,
  ephemeralTier: boolean,
): ContentSigningAuth {
  const contentAuth: ContentSigningAuth = {};
  if (options?.accessLinkId) {
    contentAuth.accessLinkId = options.accessLinkId;
  }
  if (workspaceId) {
    contentAuth.workspaceId = workspaceId;
  }
  if (ephemeralTier) {
    contentAuth.noindex = true;
    contentAuth.scriptDisabled = true;
    return contentAuth;
  }
  if (workspaceId) {
    contentAuth.scriptDisabled = false;
  }
  return contentAuth;
}

async function signAgentViewFileEntries(
  env: Env,
  artifactId: string,
  revisionId: string,
  files: AgentViewRecord["files"],
  expiresAt: string | undefined,
  contentAuth: ContentSigningAuth,
): Promise<AgentViewRecord["files"]> {
  if (!Array.isArray(files)) {
    return files;
  }
  return Promise.all(
    files.map(async (file) => {
      if (typeof file.path !== "string") {
        return file;
      }
      const { object_key: _internalObjectKey, ...publicFile } = file;
      return {
        ...publicFile,
        url: await signedContentUrl(env, artifactId, revisionId, file.path, expiresAt, contentAuth, {
          ...(typeof file.object_key === "string" ? { objectKey: file.object_key } : {}),
        }),
      };
    }),
  );
}

async function signReadyAgentViewBundle(
  env: Env,
  artifactId: string,
  revisionId: string,
  bundle: AgentViewRecord["bundle"],
  expiresAt: string | undefined,
  contentAuth: ContentSigningAuth,
): Promise<AgentViewRecord["bundle"]> {
  if (!bundle || typeof bundle !== "object" || bundle.status !== "ready") {
    return bundle;
  }
  return {
    ...bundle,
    url: await signedBundleUrl(env, artifactId, revisionId, expiresAt, contentAuth),
  };
}

async function resolveRevisionContentUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  entrypoint: string | undefined,
  files: AgentViewRecord["files"],
  storedRevisionContentUrl: unknown,
  expiresAt: string | undefined,
  contentAuth: ContentSigningAuth,
): Promise<string | undefined> {
  const contentPath =
    entrypoint ??
    (typeof storedRevisionContentUrl === "string" ? entrypointPathFromContentUrl(storedRevisionContentUrl) : undefined);
  if (contentPath) {
    return signedContentUrl(env, artifactId, revisionId, contentPath, expiresAt, contentAuth, {
      paths: revisionFilePaths(contentPath, files),
      ...revisionFileObjectKeys(files),
    });
  }
  return undefined;
}

function revisionFileObjectKeys(files: AgentViewRecord["files"]): { objectKeys?: Record<string, string> } {
  if (!Array.isArray(files)) {
    return {};
  }
  const objectKeys: Record<string, string> = {};
  for (const file of files) {
    if (typeof file.path === "string" && typeof file.object_key === "string") {
      objectKeys[file.path] = file.object_key;
    }
  }
  return Object.keys(objectKeys).length > 0 ? { objectKeys } : {};
}

function revisionFilePaths(entrypoint: string, files: AgentViewRecord["files"]): string[] {
  const paths = new Set([entrypoint]);
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file.path === "string") {
        paths.add(file.path);
      }
    }
  }
  return [...paths];
}

function existingRevisionContentUrl(data: AgentViewRecord): string | undefined {
  return typeof data.revision_content_url === "string" ? data.revision_content_url : undefined;
}

export async function signAgentViewContentUrls(
  view: unknown,
  env: Env,
  options?: { accessLinkId?: string; workspaceId?: string; ephemeralTier?: boolean; includePrivateUrl?: boolean },
): Promise<unknown> {
  if (!view || typeof view !== "object") {
    return view;
  }

  const data = view as AgentViewRecord;
  const publicFields = stripInternalAgentViewFields(data);
  const workspaceId = resolveSigningWorkspaceId(data.workspace_id, options);
  // The member viewer link (`/v/<id>`) is login-walled and member-only. Only the authenticated
  // member route opts in (`includePrivateUrl`); the public and access-link paths also pass a
  // `workspaceId` (to sign content tokens) but their viewer is anonymous, so they must NOT carry
  // it. It is absent from `PublicAgentView` and never reaches the wire on those paths.
  const privateUrl =
    options?.includePrivateUrl && typeof data.artifact_id === "string"
      ? { private_url: `${webBaseUrl(env)}/v/${encodeURIComponent(data.artifact_id)}` }
      : {};

  if (!contentSigningSecret(env)) {
    return { ...publicFields, ...privateUrl, revision_content_url: existingRevisionContentUrl(data) };
  }

  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return { ...publicFields, ...privateUrl, revision_content_url: existingRevisionContentUrl(data) };
  }

  const artifactId = data.artifact_id;
  const revisionId = data.revision_id;
  const entrypoint = typeof data.entrypoint === "string" ? data.entrypoint : undefined;
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : undefined;
  const contentAuth = buildContentSigningAuth(options, workspaceId, isEphemeralAgentView(data, options));

  const [files, bundle, revisionContentUrl] = await Promise.all([
    signAgentViewFileEntries(env, artifactId, revisionId, data.files, expiresAt, contentAuth),
    signReadyAgentViewBundle(env, artifactId, revisionId, data.bundle, expiresAt, contentAuth),
    resolveRevisionContentUrl(
      env,
      artifactId,
      revisionId,
      entrypoint,
      data.files,
      data.revision_content_url,
      expiresAt,
      contentAuth,
    ),
  ]);

  return {
    ...publicFields,
    ...privateUrl,
    revision_content_url: revisionContentUrl,
    files,
    bundle,
  };
}

export async function signPublishResult(
  result: unknown,
  env: Env,
  auth?: { workspaceId?: string; ephemeralTier?: boolean },
): Promise<unknown> {
  if (!result || typeof result !== "object") {
    return result;
  }
  const data = result as Record<string, unknown> & {
    artifact_id?: unknown;
    revision_id?: unknown;
    private_url?: unknown;
    revision_content_url?: unknown;
    agent_view_url?: unknown;
    entrypoint_object_key?: unknown;
    file_object_keys?: unknown;
    expires_at?: unknown;
  };
  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return result;
  }
  const {
    private_url: _rawPrivateUrl,
    revision_content_url: rawRevisionContentUrl,
    agent_view_url: rawAgentViewUrl,
    entrypoint_object_key: rawEntrypointObjectKey,
    file_object_keys: rawFileObjectKeys,
    ephemeral_tier: _internalEphemeralTier,
    render_mode: _internalRenderMode,
    ...rest
  } = data;
  const entrypointPath =
    typeof rawRevisionContentUrl === "string" ? entrypointPathFromContentUrl(rawRevisionContentUrl) : "index.html";
  const entrypointObjectKey =
    typeof rawEntrypointObjectKey === "string" && rawEntrypointObjectKey.length > 0
      ? rawEntrypointObjectKey
      : undefined;
  const fileObjectKeys = normalizedFileObjectKeys(rawFileObjectKeys);
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : undefined;
  const secret = agentViewSigningSecret(env);
  const contentAuth = auth?.workspaceId
    ? {
        workspaceId: auth.workspaceId,
        ...(auth.ephemeralTier
          ? { noindex: true as const, scriptDisabled: true as const }
          : { scriptDisabled: false as const }),
      }
    : undefined;
  const revisionContentUrl = await signedContentUrl(
    env,
    data.artifact_id,
    data.revision_id,
    entrypointPath,
    expiresAt,
    contentAuth,
    fileObjectKeys
      ? { paths: Object.keys(fileObjectKeys), objectKeys: fileObjectKeys }
      : entrypointObjectKey
        ? { paths: [entrypointPath], objectKey: entrypointObjectKey }
        : { paths: null },
  );
  return {
    ...rest,
    // The member viewer link (`/v/<id>`) is login-walled and member-only. Emit it only
    // when a workspace member is the viewer; the public/share path passes no auth and must
    // not receive it (it is absent from `PublicAgentView` and stays off the wire here).
    ...(auth?.workspaceId && !auth.ephemeralTier
      ? { private_url: `${webBaseUrl(env)}/v/${encodeURIComponent(data.artifact_id)}` }
      : {}),
    revision_content_url: revisionContentUrl,
    agent_view_url: secret
      ? await mintAgentViewUrl({
          baseUrl: apiBaseUrl(env),
          secret,
          payload: {
            artifact_id: data.artifact_id,
            revision_id: data.revision_id,
            exp: contentTokenExpiration(expiresAt),
          },
        })
      : typeof rawAgentViewUrl === "string"
        ? rawAgentViewUrl
        : `${apiBaseUrl(env)}/v1/public/agent-view/${data.artifact_id}.${data.revision_id}`,
  };
}

function normalizedFileObjectKeys(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const objectKeys: Record<string, string> = {};
  for (const [path, objectKey] of Object.entries(value)) {
    if (path.length > 0 && typeof objectKey === "string" && objectKey.length > 0) {
      objectKeys[path] = objectKey;
    }
  }
  return Object.keys(objectKeys).length > 0 ? objectKeys : undefined;
}

export function entrypointPathFromContentUrl(contentUrl: string): string {
  let raw = "index.html";
  try {
    const parsed = new URL(contentUrl, "http://agent-paste.local");
    raw = entrypointPathFromParsedUrl(parsed, contentUrl);
  } catch {
    raw = entrypointPathFromFallback(contentUrl);
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw || "index.html";
  }
}

function entrypointPathFromParsedUrl(parsed: URL, original: string): string {
  const segments = parsed.pathname.split("/");
  const versionSegmentIndex = segments.indexOf("v");
  if (versionSegmentIndex >= 0 && segments.length > versionSegmentIndex + 2) {
    return segments.slice(versionSegmentIndex + 2).join("/") || "index.html";
  }
  const path = parsed.pathname.replace(/^\/+/, "");
  if (!/^[a-z][a-z\d+\-.]*:/i.test(original)) {
    return path.includes("/") || path.includes(".") ? path : "index.html";
  }
  return path.includes(".") ? path : "index.html";
}

function entrypointPathFromFallback(contentUrl: string): string {
  const withoutFragment = contentUrl.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const match = withoutQuery.match(/\/v\/[^/]+\/(.+)$/);
  const path = match?.[1] ?? withoutQuery.replace(/^\/+/, "");
  return path.includes("/") || path.includes(".") ? path : "index.html";
}

function contentSigningSecret(env: Env): string | undefined {
  return resolveContentTokenSigner(env)?.signingSecret;
}

function agentViewSigningSecret(env: Env): string | undefined {
  return resolveAgentViewTokenSigner(env)?.signingSecret;
}

async function signedBundleUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  expiresAt?: string,
  auth?: { accessLinkId?: string; workspaceId?: string; noindex?: boolean; scriptDisabled?: boolean },
): Promise<string | undefined> {
  const signingSecret = contentSigningSecret(env);
  const workspaceId = auth?.workspaceId;
  if (!signingSecret || !workspaceId) {
    return undefined;
  }
  return mintBundleUrl({
    baseUrl: contentBaseUrl(env),
    secret: signingSecret,
    payload: {
      artifact_id: artifactId,
      revision_id: revisionId,
      workspace_id: workspaceId,
      ...(auth.accessLinkId ? { access_link_id: auth.accessLinkId } : {}),
      ...(auth.noindex ? { noindex: true } : {}),
      ...(auth.scriptDisabled === true
        ? { script_disabled: true }
        : auth.scriptDisabled === false
          ? { script_disabled: false }
          : {}),
      key_prefix: bundleKeyFor({
        workspaceId,
        artifactId,
        revisionId,
        storageEnv: storageEnvSegment(env.AGENT_PASTE_ENV),
      }),
      exp: contentTokenExpiration(expiresAt),
    },
  });
}

async function signedContentUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  path: string,
  expiresAt?: string,
  auth?: { accessLinkId?: string; workspaceId?: string; noindex?: boolean; scriptDisabled?: boolean },
  options?: { paths?: string[] | null; objectKey?: string; objectKeys?: Record<string, string> },
): Promise<string> {
  const signingSecret = contentSigningSecret(env);
  if (!signingSecret) {
    return `${contentBaseUrl(env)}/v/${artifactId}.${revisionId}/${encodePath(path)}`;
  }
  const paths = options?.paths === null ? {} : { paths: options?.paths ?? [path] };
  return mintContentUrl({
    baseUrl: contentBaseUrl(env),
    secret: signingSecret,
    payload: {
      artifact_id: artifactId,
      revision_id: revisionId,
      ...(auth?.workspaceId ? { workspace_id: auth.workspaceId } : {}),
      ...(auth?.accessLinkId ? { access_link_id: auth.accessLinkId } : {}),
      ...(auth?.noindex ? { noindex: true } : {}),
      ...(auth?.scriptDisabled === true
        ? { script_disabled: true }
        : auth?.scriptDisabled === false
          ? { script_disabled: false }
          : {}),
      ...paths,
      ...(options?.objectKey ? { object_key: options.objectKey } : {}),
      ...(options?.objectKeys ? { object_keys: options.objectKeys } : {}),
      exp: contentTokenExpiration(expiresAt),
    },
    path,
  });
}

function contentTokenExpiration(expiresAt: string | undefined): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  // Pinned Artifacts are exempt from Auto Deletion, so a servable Artifact can carry a
  // stored expires_at in the past; fall back to the default TTL instead of minting a dead token.
  return Number.isFinite(parsed) && parsed > nowSeconds ? parsed : nowSeconds + usagePolicy.default_ttl_seconds;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
