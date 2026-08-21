import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import { bundleKeyFor, storageEnvSegment } from "@agent-paste/db";
import { resolveContentTokenSigner } from "@agent-paste/rotation";
import { type ContentTokenPayload, mintBundleUrl, mintContentUrl } from "@agent-paste/tokens/content";
import { storeContentCapability } from "./content-capability.js";
import type { Env } from "./env.js";
import { contentBaseUrl } from "./runtime.js";

export type ContentSigningAuth = {
  accessLinkId?: string;
  workspaceId?: string;
  noindex?: boolean;
  scriptDisabled?: boolean;
};

export type ContentSigningOptions = {
  paths?: string[] | null;
  objectKey?: string;
  objectKeys?: Record<string, string>;
};

export function contentSigningSecret(env: Env): string | undefined {
  return resolveContentTokenSigner(env)?.signingSecret;
}

export async function signedBundleUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  expiresAt?: string,
  auth?: ContentSigningAuth,
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
      ...contentTokenPayload(artifactId, revisionId, expiresAt, auth, { paths: null }),
      key_prefix: bundleKeyFor({
        workspaceId,
        artifactId,
        revisionId,
        storageEnv: storageEnvSegment(env.AGENT_PASTE_ENV),
      }),
    },
  });
}

export async function signedContentUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  path: string,
  expiresAt?: string,
  auth?: ContentSigningAuth,
  options?: ContentSigningOptions,
): Promise<string> {
  const signingSecret = contentSigningSecret(env);
  if (!signingSecret) {
    return `${contentBaseUrl(env)}/v/${artifactId}.${revisionId}/${encodePath(path)}`;
  }
  return mintContentUrl({
    baseUrl: contentBaseUrl(env),
    secret: signingSecret,
    payload: contentTokenPayload(artifactId, revisionId, expiresAt, auth, {
      ...options,
      paths: options?.paths === null ? null : (options?.paths ?? [path]),
    }),
    path,
  });
}

export async function signedContentCapabilityOrigin(
  env: Env,
  artifactId: string,
  revisionId: string,
  entrypoint: string,
  expiresAt: string | undefined,
  auth: ContentSigningAuth | undefined,
  options: ContentSigningOptions,
): Promise<string | undefined> {
  const signingSecret = contentSigningSecret(env);
  if (!signingSecret) {
    if (env.CONTENT_CAPABILITY_DOMAIN) {
      throw new Error("CONTENT_CAPABILITY_DOMAIN requires a content signing secret.");
    }
    return undefined;
  }
  return storeContentCapability({
    env,
    signingSecret,
    entrypoint,
    payload: contentTokenPayload(artifactId, revisionId, expiresAt, auth, options),
  });
}

export function contentTokenExpiration(expiresAt: string | undefined): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  // Pinned Artifacts can retain a past expires_at, so mint a live default token.
  return Number.isFinite(parsed) && parsed > nowSeconds ? parsed : nowSeconds + usagePolicy.default_ttl_seconds;
}

function contentTokenPayload(
  artifactId: string,
  revisionId: string,
  expiresAt: string | undefined,
  auth: ContentSigningAuth | undefined,
  options: ContentSigningOptions,
): ContentTokenPayload {
  return {
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
    ...(Array.isArray(options.paths) ? { paths: options.paths } : {}),
    ...(options.objectKey ? { object_key: options.objectKey } : {}),
    ...(options.objectKeys ? { object_keys: options.objectKeys } : {}),
    exp: contentTokenExpiration(expiresAt),
  };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
