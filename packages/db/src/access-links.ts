import { ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS, isExpired } from "@agent-paste/config";
import { type KeyRing, verifyAccessLinkBlobWithKeyRing } from "@agent-paste/rotation";
import {
  buildAccessLinkUrl,
  defaultAccessLinkScopesBitmask,
  mintAccessLinkBlob,
  verifyAccessLinkBlob,
} from "@agent-paste/tokens/access-link";
import { createId, randomCrockford } from "./id.js";
import type { AccessLink, AccessLinkCreatedByType, AccessLinkType, Artifact } from "./types.js";

export { defaultAccessLinkScopesBitmask } from "@agent-paste/tokens/access-link";

export class AccessLinkInactiveError extends Error {
  readonly code = "access_link_inactive";

  constructor(readonly reason: "revoked" | "expired" | "lockdown" | "artifact_missing") {
    super(`access_link_inactive:${reason}`);
  }
}

export class AccessLinkLockdownError extends Error {
  readonly code = "access_link_lockdown_active";

  constructor() {
    super("access_link_lockdown_active");
  }
}

export function isAccessLinkRowExpired(link: AccessLink, now = new Date()): boolean {
  return link.expires_at !== null && isExpired(link.expires_at, now);
}

export function isArtifactAccessLinkLocked(artifact: Pick<Artifact, "access_link_lockdown_at">): boolean {
  return artifact.access_link_lockdown_at !== null;
}

export function assertAccessLinkMintable(link: AccessLink, artifact: Artifact | null, now = new Date()): void {
  if (!artifact) {
    throw new AccessLinkInactiveError("artifact_missing");
  }
  if (isArtifactAccessLinkLocked(artifact)) {
    throw new AccessLinkLockdownError();
  }
  if (link.revoked_at) {
    throw new AccessLinkInactiveError("revoked");
  }
  if (isAccessLinkRowExpired(link, now)) {
    throw new AccessLinkInactiveError("expired");
  }
}

export function computeAccessLinkUrlExpMs(link: AccessLink, nowMs: number): number {
  const defaultCap = nowMs + ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS;
  if (!link.expires_at) {
    return defaultCap;
  }
  return Math.min(new Date(link.expires_at).getTime(), defaultCap);
}

function assertValidAccessLinkScopesBitmask(scopesBitmask: number | undefined): number {
  const value = scopesBitmask ?? defaultAccessLinkScopesBitmask();
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("access_link_invalid_scopes_bitmask");
  }
  return value;
}

const ACCESS_LINK_EXPIRES_AT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

function parseAccessLinkExpiresAt(expiresAt: string | null | undefined): string | null {
  if (expiresAt === undefined || expiresAt === null) {
    return null;
  }
  const trimmed = expiresAt.trim();
  if (!ACCESS_LINK_EXPIRES_AT_TIMEZONE.test(trimmed)) {
    throw new Error("access_link_invalid_expires_at");
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error("access_link_invalid_expires_at");
  }
  return new Date(parsed).toISOString();
}

export function createAccessLinkRow(input: {
  workspaceId: string;
  artifactId: string;
  type: AccessLinkType;
  revisionId?: string | null;
  scopesBitmask?: number;
  expiresAt?: string | null;
  createdByType: AccessLinkCreatedByType;
  createdById: string;
  now: string;
}): AccessLink {
  if (input.type === "share" && input.revisionId) {
    throw new Error("access_link_share_cannot_pin_revision");
  }
  if (input.type === "revision" && !input.revisionId) {
    throw new Error("access_link_revision_requires_revision_id");
  }

  return {
    id: createId("al"),
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: input.type === "revision" ? (input.revisionId ?? null) : null,
    public_id: randomCrockford(16),
    type: input.type,
    scopes_bitmask: assertValidAccessLinkScopesBitmask(input.scopesBitmask),
    expires_at: parseAccessLinkExpiresAt(input.expiresAt),
    created_by_type: input.createdByType,
    created_by_id: input.createdById,
    created_at: input.now,
    revoked_at: null,
  };
}

export async function mintAccessLinkSignedUrl(input: {
  link: AccessLink;
  artifact: Artifact | null;
  appBaseUrl: string;
  signingSecret: string;
  signingKid: number;
  now?: Date;
}): Promise<{ url: string; blob: string; exp: number }> {
  const now = input.now ?? new Date();
  assertAccessLinkMintable(input.link, input.artifact, now);
  const exp = computeAccessLinkUrlExpMs(input.link, now.getTime());
  const scopes = input.link.scopes_bitmask;
  const blob = await mintAccessLinkBlob({
    publicId: input.link.public_id,
    kid: input.signingKid,
    exp,
    scopes,
    signingSecret: input.signingSecret,
  });
  return {
    url: buildAccessLinkUrl({ appBaseUrl: input.appBaseUrl, publicId: input.link.public_id, blob }),
    blob,
    exp,
  };
}

export async function remintAccessLinkSignedUrl(
  input: Parameters<typeof mintAccessLinkSignedUrl>[0],
): Promise<{ url: string; blob: string; exp: number }> {
  return mintAccessLinkSignedUrl(input);
}

export async function verifyAccessLinkSignedBlob(input: {
  publicId: string;
  blob: string;
  signingSecret: string;
  now?: Date;
}) {
  const clock = input.now ? { now: () => input.now?.getTime() ?? Date.now() } : undefined;
  return verifyAccessLinkBlob({
    publicId: input.publicId,
    blob: input.blob,
    signingSecret: input.signingSecret,
    ...(clock ? { clock } : {}),
  });
}

export async function verifyAccessLinkSignedBlobWithRing(input: {
  publicId: string;
  blob: string;
  ring: KeyRing;
  now?: Date;
}) {
  const clock = input.now ? { now: () => input.now?.getTime() ?? Date.now() } : undefined;
  return verifyAccessLinkBlobWithKeyRing({ publicId: input.publicId, blob: input.blob }, input.ring, clock);
}
