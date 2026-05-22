import { base64UrlEncode, randomCrockford } from "./id.js";

export type GeneratedApiKey = {
  secret: string;
  publicId: string;
  secretHmac: string;
};

export async function generateApiKey(env: "preview" | "production" | "live", pepper: string): Promise<GeneratedApiKey> {
  const publicId = randomCrockford(16);
  const secretSegment = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return {
    secret: `ap_pk_${env}_${publicId}_${secretSegment}`,
    publicId,
    secretHmac: await hmacBase64Url(secretSegment, pepper),
  };
}

export function parseApiKey(value: string) {
  const match = value.match(/^ap_pk_(preview|production|live)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{32,})$/);
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
  return constantTimeEqual(await hmacBase64Url(parsed.secret, pepper), expectedSecretHmac);
}

async function hmacBase64Url(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
