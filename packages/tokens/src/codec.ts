import { type Clock, systemClock } from "./clock.js";
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmac } from "./crypto.js";

/**
 * The shared wire scheme for every signed bearer token: `base64url(JSON.stringify(payload))` then
 * `"."` then `base64url(hmac(encodedPayload, secret))`. The signature covers the encoded payload
 * string, not the raw JSON.
 */
export async function sign(payload: object, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies signature, shape, and expiration together and returns the typed payload or `null`. It
 * never throws: a malformed token, bad signature, failed shape guard, or expired `exp` all return
 * `null`. Expiration is compared in whole seconds against the injected clock (default system).
 */
export async function verify<T extends { exp: number }>(
  token: string,
  secret: string,
  options: { isValid: (value: unknown) => value is T; clock?: Clock | undefined },
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }

  if (!options.isValid(payload)) {
    return null;
  }

  const nowSeconds = Math.floor((options.clock ?? systemClock).now() / 1000);
  if (payload.exp < nowSeconds) {
    return null;
  }

  return payload;
}
