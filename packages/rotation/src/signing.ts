import type { Clock } from "@agent-paste/tokens";
import { type AccessLinkSignedPayload, verifyAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { verifyUploadToken } from "@agent-paste/tokens/upload-url";
import type { KeyRing } from "./key-ring.js";

/**
 * Verifies a content token against every kid in the overlap window. Returns the payload
 * from the first kid that validates, or `null` when none match.
 */
export async function verifyContentTokenWithKeyRing(
  token: string,
  ring: KeyRing,
  clock?: Clock,
): Promise<Awaited<ReturnType<typeof verifyContentToken>>> {
  for (const entry of ring.verifyEntries()) {
    const payload = await verifyContentToken(token, entry.secret, clock);
    if (payload) {
      return payload;
    }
  }
  return null;
}

/**
 * Verifies an upload URL token against every kid in the overlap window.
 */
/**
 * Verifies an agent-view token against every kid in the overlap window.
 */
export async function verifyAgentViewTokenWithKeyRing(
  token: string,
  ring: KeyRing,
  clock?: Clock,
): Promise<Awaited<ReturnType<typeof verifyAgentViewToken>>> {
  for (const entry of ring.verifyEntries()) {
    const payload = await verifyAgentViewToken(token, entry.secret, clock);
    if (payload) {
      return payload;
    }
  }
  return null;
}

export async function verifyUploadTokenWithKeyRing(
  token: string,
  ring: KeyRing,
  clock?: Clock,
): Promise<Awaited<ReturnType<typeof verifyUploadToken>>> {
  for (const entry of ring.verifyEntries()) {
    const payload = await verifyUploadToken(token, entry.secret, clock);
    if (payload) {
      return payload;
    }
  }
  return null;
}

export async function verifyAccessLinkBlobWithKeyRing(
  input: { publicId: string; blob: string },
  ring: KeyRing,
  clock?: Clock,
): Promise<AccessLinkSignedPayload | null> {
  for (const entry of ring.verifyEntries()) {
    const payload = await verifyAccessLinkBlob({
      publicId: input.publicId,
      blob: input.blob,
      signingSecret: entry.secret,
      ...(clock ? { clock } : {}),
    });
    if (payload) {
      return payload;
    }
  }
  return null;
}
