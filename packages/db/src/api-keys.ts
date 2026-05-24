import { constantTimeEqual, hmac } from "@agent-paste/tokens/crypto";
import { base64UrlEncode, randomCrockford } from "./id.js";

export type GeneratedApiKey = {
  secret: string;
  publicId: string;
  secretHmac: string;
};

export async function generateApiKey(env: "preview" | "production", pepper: string): Promise<GeneratedApiKey> {
  const publicId = randomCrockford(16);
  const secretSegment = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return {
    secret: `ap_pk_${env}_${publicId}_${secretSegment}`,
    publicId,
    secretHmac: await hmac(secretSegment, pepper),
  };
}

export function parseApiKey(value: string) {
  const match = value.match(/^ap_pk_(preview|production)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{32,})$/);
  if (!match?.[2] || !match[3]) {
    return null;
  }
  return { publicId: match[2], secret: match[3] };
}

export async function verifyApiKeySecret(
  apiKey: string,
  expectedPublicId: string,
  expectedSecretHmac: string,
  pepper: string,
) {
  const parsed = parseApiKey(apiKey);
  if (!parsed || parsed.publicId !== expectedPublicId) {
    return false;
  }
  return constantTimeEqual(await hmac(parsed.secret, pepper), expectedSecretHmac);
}
