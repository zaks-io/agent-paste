import type { Clock } from "@agent-paste/tokens";
import { type AccessLinkSignedPayload, mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { type AgentViewTokenPayload, mintAgentViewToken, verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import { type ContentTokenPayload, mintContentToken, verifyContentToken } from "@agent-paste/tokens/content";
import { mintUploadToken, type SignedUploadPayload, verifyUploadToken } from "@agent-paste/tokens/upload-url";
import type { KeyRing } from "./key-ring.js";
import {
  verifyAccessLinkBlobWithKeyRing,
  verifyAgentViewTokenWithKeyRing,
  verifyContentTokenWithKeyRing,
  verifyUploadTokenWithKeyRing,
} from "./signing.js";
import { accessLinkSigningRingFromEnv, contentSigningRingFromEnv, uploadSigningRingFromEnv } from "./workers.js";

/**
 * Resolves which key material signs and verifies a signed-token kind for a Worker
 * `env`, hiding the override-then-ring-then-bare cascade behind one place. Each kind
 * exposes a `sign`/`verify` pair matched to its natural payload shape; the cascade and
 * rotation overlap-window walking live here rather than inlined at every call site.
 *
 * Mint uses the active signing secret (a rotation override, else the ring's signing
 * kid, else the bare secret); verify accepts every kid in the overlap window so a token
 * minted under the prior kid still resolves during a rotation.
 */

/**
 * Resolves the active signing secret for `env`: an explicit override wins, then the
 * ring's current signing kid, then the bare base secret. `undefined` means the kind has
 * no signing material configured and callers fall back to their unsigned path.
 */
function resolveSigningSecret(override: string | undefined, ring: KeyRing | undefined, bare: string | undefined) {
  if (override) {
    return override;
  }
  return ring?.signingSecret() ?? bare;
}

export type ContentTokenSigner = {
  /** The active signing secret, for callers that build content/bundle URLs via `mintContentUrl`/`mintBundleUrl`. */
  signingSecret: string;
  sign(payload: ContentTokenPayload): Promise<string>;
  verify(token: string, clock?: Clock): Promise<ContentTokenPayload | null>;
};

export type AgentViewTokenSigner = {
  /** The active signing secret, for callers that build the agent-view URL via `mintAgentViewUrl`. */
  signingSecret: string;
  sign(payload: AgentViewTokenPayload): Promise<string>;
  verify(token: string, clock?: Clock): Promise<AgentViewTokenPayload | null>;
};

export type UploadTokenSigner = {
  /** The active signing secret, for callers that build the signed PUT URL via `mintUploadUrl`. */
  signingSecret: string;
  sign(payload: SignedUploadPayload): Promise<string>;
  verify(token: string, clock?: Clock): Promise<SignedUploadPayload | null>;
};

export type AccessLinkSigner = {
  /** The active signing secret and kid, for the db mint path that calls `mintAccessLinkBlob` itself. */
  signingSecret: string;
  signingKid: number;
  sign(input: { publicId: string; kid: number; exp: number; scopes: number }): Promise<string>;
  verify(input: { publicId: string; blob: string }, clock?: Clock): Promise<AccessLinkSignedPayload | null>;
};

type ContentSigningEnv = {
  CONTENT_SIGNING_SECRET?: string;
  CONTENT_SIGNING_SECRET_V2?: string;
  CONTENT_SIGNING_KID?: string;
};

type AgentViewSigningEnv = ContentSigningEnv & {
  AGENT_VIEW_SIGNING_SECRET?: string;
};

type UploadSigningEnv = {
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET_V2?: string;
  UPLOAD_SIGNING_KID?: string;
};

type AccessLinkSigningEnv = {
  ACCESS_LINK_SIGNING_KEY_V1?: string;
  ACCESS_LINK_SIGNING_KEY_V2?: string;
  ACCESS_LINK_SIGNING_KID?: string;
};

/**
 * Content-Gateway Token signer. Used for both file and bundle content URLs; the URL
 * shape is the caller's concern, this owns only the signing material. Returns
 * `undefined` when no content signing secret is configured.
 */
export function resolveContentTokenSigner(env: ContentSigningEnv): ContentTokenSigner | undefined {
  const ring = contentSigningRingFromEnv(env);
  const secret = resolveSigningSecret(undefined, ring, env.CONTENT_SIGNING_SECRET);
  if (!secret) {
    return undefined;
  }
  return {
    signingSecret: secret,
    sign: (payload) => mintContentToken(payload, secret),
    verify: (token, clock) =>
      ring ? verifyContentTokenWithKeyRing(token, ring, clock) : verifyContentToken(token, secret, clock),
  };
}

/**
 * Agent-View Token signer. Shares the content signing material by default so a single
 * rotation covers both surfaces; `AGENT_VIEW_SIGNING_SECRET` overrides for the rare case
 * of an independent agent-view key. Returns `undefined` when neither is configured.
 */
export function resolveAgentViewTokenSigner(env: AgentViewSigningEnv): AgentViewTokenSigner | undefined {
  const ring = env.AGENT_VIEW_SIGNING_SECRET ? undefined : contentSigningRingFromEnv(env);
  const secret = resolveSigningSecret(env.AGENT_VIEW_SIGNING_SECRET, ring, env.CONTENT_SIGNING_SECRET);
  if (!secret) {
    return undefined;
  }
  return {
    signingSecret: secret,
    sign: (payload) => mintAgentViewToken(payload, secret),
    verify: (token, clock) =>
      ring ? verifyAgentViewTokenWithKeyRing(token, ring, clock) : verifyAgentViewToken(token, secret, clock),
  };
}

/**
 * Upload PUT signed-URL token signer. Returns `undefined` when `UPLOAD_SIGNING_SECRET`
 * is absent; the upload Worker treats that as a hard misconfiguration.
 */
export function resolveUploadTokenSigner(env: UploadSigningEnv): UploadTokenSigner | undefined {
  const ring = uploadSigningRingFromEnv(env);
  const secret = resolveSigningSecret(undefined, ring, env.UPLOAD_SIGNING_SECRET);
  if (!secret) {
    return undefined;
  }
  return {
    signingSecret: secret,
    sign: (payload) => mintUploadToken(payload, secret),
    verify: (token, clock) =>
      ring ? verifyUploadTokenWithKeyRing(token, ring, clock) : verifyUploadToken(token, secret, clock),
  };
}

/**
 * Access Link Signed URL signer. The blob carries its own kid, so mint and verify both
 * run through the ring; returns `undefined` when no access-link signing key is set.
 */
export function resolveAccessLinkSigner(env: AccessLinkSigningEnv): AccessLinkSigner | undefined {
  const ring = accessLinkSigningRingFromEnv(env);
  if (!ring) {
    return undefined;
  }
  return {
    signingSecret: ring.signingSecret(),
    signingKid: ring.signingKid,
    sign: (input) =>
      mintAccessLinkBlob({
        publicId: input.publicId,
        kid: input.kid,
        exp: input.exp,
        scopes: input.scopes,
        signingSecret: ring.secretForKid(input.kid) ?? ring.signingSecret(),
      }),
    verify: (input, clock) => verifyAccessLinkBlobWithKeyRing(input, ring, clock),
  };
}
