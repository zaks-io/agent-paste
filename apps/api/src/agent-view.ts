import { resolveAgentViewTokenSigner } from "@agent-paste/rotation";
import { type AgentViewTokenPayload, mintAgentViewUrl } from "@agent-paste/tokens/agent-view";
import { contentCapabilityUrl } from "./content-capability.js";
import {
  type ContentSigningAuth,
  contentSigningSecret,
  contentTokenExpiration,
  signedBundleUrl,
  signedContentCapabilityOrigin,
  signedContentUrl,
} from "./content-signing.js";
import type { Env } from "./env.js";
import { apiBaseUrl, webBaseUrl } from "./runtime.js";

export async function verifyAgentViewTokenForEnv(token: string, env: Env): Promise<AgentViewTokenPayload | null> {
  const signer = resolveAgentViewTokenSigner(env);
  return signer ? signer.verify(token) : null;
}

type AgentViewRecord = {
  workspace_id?: unknown;
  capability_id?: unknown;
  pinned_at?: unknown;
  artifact_updated_at?: unknown;
  artifact_id?: unknown;
  revision_id?: unknown;
  revision_number?: unknown;
  entrypoint?: unknown;
  render_mode?: unknown;
  expires_at?: unknown;
  revision_content_url?: unknown;
  ephemeral_tier?: unknown;
  bundle?: { status?: unknown; url?: unknown } & Record<string, unknown>;
  files?: Array<{ path?: unknown; url?: unknown; object_key?: unknown } & Record<string, unknown>>;
};

function stripInternalAgentViewFields(
  data: AgentViewRecord,
): Omit<
  AgentViewRecord,
  | "workspace_id"
  | "capability_id"
  | "pinned_at"
  | "artifact_updated_at"
  | "revision_number"
  | "revision_content_url"
  | "render_mode"
> {
  const {
    workspace_id: _internalWorkspaceId,
    capability_id: _internalCapabilityId,
    pinned_at: _internalPinnedAt,
    artifact_updated_at: _internalArtifactUpdatedAt,
    revision_number: _internalRevisionNumber,
    revision_content_url: _rawRevisionContentUrl,
    render_mode: _internalRenderMode,
    ...publicFields
  } = data;
  // Strip internal R2 object keys here too, so the early-return paths (missing
  // signing secret, malformed ids) and non-string-path entries never leak them;
  // the signing paths read the original `data.files`, not this copy.
  if (Array.isArray(publicFields.files)) {
    publicFields.files = publicFields.files.map(({ object_key: _internalObjectKey, ...publicFile }) => publicFile);
  }
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
      const { object_key: _internalObjectKey, ...publicFile } = file;
      if (typeof file.path !== "string") {
        return publicFile;
      }
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
  options?: {
    accessLinkId?: string;
    workspaceId?: string;
    ephemeralTier?: boolean;
    includePrivateUrl?: boolean;
    refreshCapabilityManifest?: boolean;
  },
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
    if (env.CONTENT_CAPABILITY_DOMAIN) {
      throw new Error("CONTENT_CAPABILITY_DOMAIN requires a content signing secret.");
    }
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
  const contentPath =
    entrypoint ??
    (typeof data.revision_content_url === "string"
      ? entrypointPathFromContentUrl(data.revision_content_url)
      : undefined);
  if (contentPath && options?.refreshCapabilityManifest) {
    await signedContentCapabilityOrigin(
      env,
      artifactId,
      revisionId,
      contentPath,
      expiresAt,
      contentAuth,
      {
        paths: revisionFilePaths(contentPath, data.files),
        ...revisionFileObjectKeys(data.files),
      },
      !options?.accessLinkId && typeof data.capability_id === "string" ? data.capability_id : undefined,
      typeof data.revision_number === "number" && typeof data.artifact_updated_at === "string"
        ? {
            revisionNumber: data.revision_number,
            artifactUpdatedAt: data.artifact_updated_at,
            persistent: typeof data.pinned_at === "string",
          }
        : undefined,
    );
  }

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
    capability_id?: unknown;
    pinned_at?: unknown;
    artifact_updated_at?: unknown;
    revision_number?: unknown;
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
    capability_id: rawCapabilityId,
    pinned_at: rawPinnedAt,
    artifact_updated_at: rawArtifactUpdatedAt,
    revision_number: rawRevisionNumber,
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
        ...(auth.ephemeralTier ? { noindex: true as const } : {}),
      }
    : undefined;
  const contentOptions = fileObjectKeys
    ? { paths: Object.keys(fileObjectKeys), objectKeys: fileObjectKeys }
    : entrypointObjectKey
      ? { paths: [entrypointPath], objectKey: entrypointObjectKey }
      : { paths: null };
  const capabilityOrigin = await signedContentCapabilityOrigin(
    env,
    data.artifact_id,
    data.revision_id,
    entrypointPath,
    expiresAt,
    contentAuth,
    contentOptions,
    typeof rawCapabilityId === "string" ? rawCapabilityId : undefined,
    typeof rawRevisionNumber === "number" && typeof rawArtifactUpdatedAt === "string"
      ? {
          revisionNumber: rawRevisionNumber,
          artifactUpdatedAt: rawArtifactUpdatedAt,
          persistent: typeof rawPinnedAt === "string",
        }
      : undefined,
  );
  const revisionContentUrl = capabilityOrigin
    ? contentCapabilityUrl(capabilityOrigin, entrypointPath)
    : await signedContentUrl(
        env,
        data.artifact_id,
        data.revision_id,
        entrypointPath,
        expiresAt,
        contentAuth,
        contentOptions,
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

function agentViewSigningSecret(env: Env): string | undefined {
  return resolveAgentViewTokenSigner(env)?.signingSecret;
}
