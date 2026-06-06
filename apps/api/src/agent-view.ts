import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import { bundleKeyFor, storageEnvSegment } from "@agent-paste/db";
import { resolveAgentViewTokenSigner, resolveContentTokenSigner } from "@agent-paste/rotation";
import { type AgentViewTokenPayload, mintAgentViewUrl } from "@agent-paste/tokens/agent-view";
import { mintBundleUrl, mintContentUrl } from "@agent-paste/tokens/content";
import type { Env } from "./env.js";
import { apiBaseUrl, contentBaseUrl } from "./runtime.js";

export async function verifyAgentViewTokenForEnv(token: string, env: Env): Promise<AgentViewTokenPayload | null> {
  const signer = resolveAgentViewTokenSigner(env);
  return signer ? signer.verify(token) : null;
}

type AgentViewRecord = {
  workspace_id?: unknown;
  artifact_id?: unknown;
  revision_id?: unknown;
  entrypoint?: unknown;
  expires_at?: unknown;
  view_url?: unknown;
  ephemeral_tier?: unknown;
  bundle?: { status?: unknown; url?: unknown } & Record<string, unknown>;
  files?: Array<{ path?: unknown; url?: unknown } & Record<string, unknown>>;
};

type ContentSigningAuth = {
  accessLinkId?: string;
  workspaceId?: string;
  noindex?: boolean;
  scriptDisabled?: boolean;
};

function stripInternalWorkspaceId(data: AgentViewRecord): Omit<AgentViewRecord, "workspace_id"> {
  const { workspace_id: _internalWorkspaceId, ...publicFields } = data;
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
      return {
        ...file,
        url: await signedContentUrl(env, artifactId, revisionId, file.path, expiresAt, contentAuth),
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

async function resolveSignedAgentViewUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  entrypoint: string | undefined,
  storedViewUrl: unknown,
  expiresAt: string | undefined,
  contentAuth: ContentSigningAuth,
): Promise<string | undefined> {
  if (entrypoint) {
    return signedContentUrl(env, artifactId, revisionId, entrypoint, expiresAt, contentAuth);
  }
  if (typeof storedViewUrl === "string") {
    return storedViewUrl;
  }
  return undefined;
}

export async function signAgentViewContentUrls(
  view: unknown,
  env: Env,
  options?: { accessLinkId?: string; workspaceId?: string; ephemeralTier?: boolean },
): Promise<unknown> {
  if (!view || typeof view !== "object") {
    return view;
  }

  const data = view as AgentViewRecord;
  const publicFields = stripInternalWorkspaceId(data);

  if (!contentSigningSecret(env)) {
    return publicFields;
  }

  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return publicFields;
  }

  const artifactId = data.artifact_id;
  const revisionId = data.revision_id;
  const entrypoint = typeof data.entrypoint === "string" ? data.entrypoint : undefined;
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : undefined;
  const workspaceId = resolveSigningWorkspaceId(data.workspace_id, options);
  const contentAuth = buildContentSigningAuth(options, workspaceId, isEphemeralAgentView(data, options));

  const [files, bundle, view_url] = await Promise.all([
    signAgentViewFileEntries(env, artifactId, revisionId, data.files, expiresAt, contentAuth),
    signReadyAgentViewBundle(env, artifactId, revisionId, data.bundle, expiresAt, contentAuth),
    resolveSignedAgentViewUrl(env, artifactId, revisionId, entrypoint, data.view_url, expiresAt, contentAuth),
  ]);

  return {
    ...publicFields,
    view_url,
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
  const data = result as {
    artifact_id?: unknown;
    revision_id?: unknown;
    view_url?: unknown;
    agent_view_url?: unknown;
    expires_at?: unknown;
  };
  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return result;
  }
  const entrypointPath = typeof data.view_url === "string" ? entrypointPathFromViewUrl(data.view_url) : "index.html";
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
  return {
    ...data,
    view_url: await signedContentUrl(env, data.artifact_id, data.revision_id, entrypointPath, expiresAt, contentAuth),
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
      : typeof data.agent_view_url === "string"
        ? data.agent_view_url
        : `${apiBaseUrl(env)}/v1/public/agent-view/${data.artifact_id}.${data.revision_id}`,
  };
}

export function entrypointPathFromViewUrl(viewUrl: string): string {
  const match = viewUrl.match(/\/v\/[^/]+\/([^?#]+)$/);
  const raw = match?.[1] ?? "index.html";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw || "index.html";
  }
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
): Promise<string> {
  const signingSecret = contentSigningSecret(env);
  if (!signingSecret) {
    return `${contentBaseUrl(env)}/v/${artifactId}.${revisionId}/${encodePath(path)}`;
  }
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
      paths: [path],
      exp: contentTokenExpiration(expiresAt),
    },
    path,
  });
}

function contentTokenExpiration(expiresAt: string | undefined): number {
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000) + usagePolicy.default_ttl_seconds;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
