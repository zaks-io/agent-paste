import type { Clock } from "./clock.js";
import { decodeCrockfordPublicId } from "./crockford.js";
import { base64UrlDecode, base64UrlEncode } from "./crypto.js";

export const ACCESS_LINK_PAYLOAD_VERSION = 1;
export const ACCESS_LINK_PAYLOAD_BYTE_LENGTH = 44;

export const ACCESS_LINK_SCOPE = {
  VIEW_ARTIFACT: 1 << 0,
  LIST_REVISIONS: 1 << 1,
  VIEW_RAW_CONTENT: 1 << 2,
} as const;

export type AccessLinkSignedPayload = {
  version: number;
  kid: number;
  exp: number;
  scopes: number;
  publicId: string;
};

export type MintAccessLinkBlobInput = {
  publicId: string;
  kid: number;
  exp: number;
  scopes: number;
  signingSecret: string;
};

async function hmacSha256Bytes(message: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, message as BufferSource);
  return new Uint8Array(signature);
}

function packSignatureInput(input: {
  version: number;
  kid: number;
  exp: number;
  scopes: number;
  publicIdBytes: Uint8Array;
}): Uint8Array {
  const buffer = new Uint8Array(12 + input.publicIdBytes.length);
  buffer[0] = input.version;
  buffer[1] = input.kid;
  const view = new DataView(buffer.buffer);
  view.setBigUint64(2, BigInt(input.exp), false);
  view.setUint16(10, input.scopes, false);
  buffer.set(input.publicIdBytes, 12);
  return buffer;
}

function parsePayloadBytes(bytes: Uint8Array): AccessLinkSignedPayload | null {
  if (bytes.length !== ACCESS_LINK_PAYLOAD_BYTE_LENGTH) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0] ?? -1;
  const kid = bytes[1] ?? -1;
  if (version !== ACCESS_LINK_PAYLOAD_VERSION || kid < 1 || kid > 255) {
    return null;
  }
  const exp = Number(view.getBigUint64(2, false));
  const scopes = view.getUint16(10, false);
  return { version, kid, exp, scopes, publicId: "" };
}

export async function mintAccessLinkBlob(input: MintAccessLinkBlobInput): Promise<string> {
  const publicIdBytes = decodeCrockfordPublicId(input.publicId);
  if (!publicIdBytes) {
    throw new Error("access_link_invalid_public_id");
  }
  if (input.kid < 1 || input.kid > 255) {
    throw new Error("access_link_invalid_kid");
  }
  if (!Number.isInteger(input.exp) || input.exp < 0) {
    throw new Error("access_link_invalid_exp");
  }
  if (!Number.isInteger(input.scopes) || input.scopes < 0 || input.scopes > 0xffff) {
    throw new Error("access_link_invalid_scopes");
  }

  const signatureInput = packSignatureInput({
    version: ACCESS_LINK_PAYLOAD_VERSION,
    kid: input.kid,
    exp: input.exp,
    scopes: input.scopes,
    publicIdBytes,
  });
  const signature = await hmacSha256Bytes(signatureInput, input.signingSecret);
  const payload = new Uint8Array(ACCESS_LINK_PAYLOAD_BYTE_LENGTH);
  payload.set(signatureInput, 0);
  payload.set(signature, 12);
  return base64UrlEncode(payload);
}

export async function verifyAccessLinkBlob(input: {
  publicId: string;
  blob: string;
  signingSecret: string;
  clock?: Clock;
}): Promise<AccessLinkSignedPayload | null> {
  const publicIdBytes = decodeCrockfordPublicId(input.publicId);
  if (!publicIdBytes) {
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(input.blob);
  } catch {
    return null;
  }

  const parsed = parsePayloadBytes(bytes);
  if (!parsed) {
    return null;
  }

  const signatureInput = packSignatureInput({
    version: parsed.version,
    kid: parsed.kid,
    exp: parsed.exp,
    scopes: parsed.scopes,
    publicIdBytes,
  });
  const expectedSignature = await hmacSha256Bytes(signatureInput, input.signingSecret);
  const actualSignature = bytes.slice(12);
  if (expectedSignature.length !== actualSignature.length) {
    return null;
  }

  let diff = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    diff |= (expectedSignature[index] ?? 0) ^ (actualSignature[index] ?? 0);
  }
  if (diff !== 0) {
    return null;
  }

  const nowMs = input.clock?.now() ?? Date.now();
  if (parsed.exp <= nowMs) {
    return null;
  }

  return { ...parsed, publicId: input.publicId };
}

export function buildAccessLinkUrl(input: { appBaseUrl: string; publicId: string; blob: string }): string {
  const base = input.appBaseUrl.replace(/\/$/, "");
  return `${base}/al/${input.publicId}#${input.blob}`;
}

export function defaultAccessLinkScopesBitmask(): number {
  return ACCESS_LINK_SCOPE.VIEW_ARTIFACT | ACCESS_LINK_SCOPE.LIST_REVISIONS | ACCESS_LINK_SCOPE.VIEW_RAW_CONTENT;
}

/** Constant-time compare for tests and redaction helpers. */
export function accessLinkBlobLooksValid(blob: string): boolean {
  try {
    return base64UrlDecode(blob).length === ACCESS_LINK_PAYLOAD_BYTE_LENGTH;
  } catch {
    return false;
  }
}
