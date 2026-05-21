const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const API_KEY_SECRET_BYTES = 32;

export type ApiKeyEnvironment = "preview" | "production" | "live";

export type ParsedApiKey = {
  env: ApiKeyEnvironment;
  publicId: string;
  secret: string;
};

export type ApiKeySecretMaterial = {
  publicId: string;
  secretHmac: string;
  pepperKid: number;
};

export type GeneratedApiKey = {
  secret: string;
  material: ApiKeySecretMaterial;
};

export async function generateApiKey(input: {
  env?: ApiKeyEnvironment;
  pepper: string;
  pepperKid?: number;
}): Promise<GeneratedApiKey> {
  const env = input.env ?? "preview";
  const publicId = randomCrockford(16);
  const secretSegment = randomBase64Url(API_KEY_SECRET_BYTES);
  const secret = `ap_pk_${env}_${publicId}_${secretSegment}`;
  return {
    secret,
    material: {
      publicId,
      secretHmac: await hmacBase64Url(secretSegment, input.pepper),
      pepperKid: input.pepperKid ?? 1,
    },
  };
}

export function parseApiKey(value: string): ParsedApiKey | null {
  const match = value.match(/^ap_pk_(preview|production|live)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{32,})$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return { env: match[1] as ApiKeyEnvironment, publicId: match[2], secret: match[3] };
}

export async function verifyApiKeySecret(input: {
  apiKey: string;
  expectedPublicId: string;
  expectedSecretHmac: string;
  pepper: string;
}): Promise<boolean> {
  const parsed = parseApiKey(input.apiKey);
  if (!parsed || parsed.publicId !== input.expectedPublicId) {
    return false;
  }
  const actual = await hmacBase64Url(parsed.secret, input.pepper);
  return constantTimeEqual(actual, input.expectedSecretHmac);
}

export async function hashAdminToken(token: string, pepper: string): Promise<string> {
  return hmacBase64Url(token, pepper);
}

export async function verifyAdminToken(token: string, expectedHmac: string, pepper: string): Promise<boolean> {
  return constantTimeEqual(await hashAdminToken(token, pepper), expectedHmac);
}

export async function hmacBase64Url(value: string, secret: string): Promise<string> {
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

export function randomCrockford(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte: number) => CROCKFORD[byte % CROCKFORD.length]).join("");
}

export function randomBase64Url(bytesLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytesLength)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
