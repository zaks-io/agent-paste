import type { Clock } from "./clock.js";
import { sign, verify } from "./codec.js";
import { encodePath } from "./url.js";

export type SignedUploadPayload = {
  sid: string;
  wid: string;
  path: string;
  key: string;
  size: number;
  exp: number;
};

export function isValidUploadPayload(value: unknown): value is SignedUploadPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<SignedUploadPayload>;
  return (
    typeof payload.sid === "string" &&
    payload.sid.length > 0 &&
    typeof payload.wid === "string" &&
    payload.wid.length > 0 &&
    typeof payload.path === "string" &&
    payload.path.length > 0 &&
    typeof payload.key === "string" &&
    payload.key.length > 0 &&
    typeof payload.size === "number" &&
    Number.isSafeInteger(payload.size) &&
    payload.size >= 0 &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp)
  );
}

export function mintUploadToken(payload: SignedUploadPayload, secret: string): Promise<string> {
  return sign(payload, secret);
}

export function verifyUploadToken(token: string, secret: string, clock?: Clock): Promise<SignedUploadPayload | null> {
  return verify(token, secret, { isValid: isValidUploadPayload, clock });
}

/**
 * Signs an upload token and builds the signed PUT URL
 * `{baseUrl}/v1/upload-sessions/{sid}/files/{path}?token={token}`.
 */
export async function mintUploadUrl(input: {
  baseUrl: string;
  secret: string;
  payload: SignedUploadPayload;
}): Promise<string> {
  const token = await mintUploadToken(input.payload, input.secret);
  const session = encodeURIComponent(input.payload.sid);
  return `${input.baseUrl}/v1/upload-sessions/${session}/files/${encodePath(input.payload.path)}?token=${encodeURIComponent(token)}`;
}
