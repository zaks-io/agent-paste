import { base64UrlDecode, hmac } from "@agent-paste/tokens/crypto";
import { base64UrlEncode, randomCrockford } from "./id.js";

export type GeneratedClaimToken = {
  secret: string;
  publicId: string;
  tokenHash: Uint8Array;
};

const CLAIM_CODE_PATTERN = /^clm_[0-9A-HJKMNP-TV-Z]{26}$/;
const CLAIM_TOKEN_PATTERN =
  /^ap_ct_(preview|production)_([0-9A-HJKMNP-TV-Z]{16})(?:\.(clm_[0-9A-HJKMNP-TV-Z]{26}))?_([A-Za-z0-9_-]{32,})$/;

export function digestToBytes(digest: string): Uint8Array {
  return base64UrlDecode(digest);
}

export async function generateClaimToken(
  env: "preview" | "production",
  pepper: string,
  claimCode?: string,
): Promise<GeneratedClaimToken> {
  const publicId = randomCrockford(16);
  const secretSegment = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const claimCodeSegment = claimCode && CLAIM_CODE_PATTERN.test(claimCode) ? `.${claimCode}` : "";
  return {
    secret: `ap_ct_${env}_${publicId}${claimCodeSegment}_${secretSegment}`,
    publicId,
    tokenHash: digestToBytes(await hmac(secretSegment, pepper)),
  };
}

export function parseClaimToken(value: string) {
  const match = value.match(CLAIM_TOKEN_PATTERN);
  if (!match?.[2] || !match[4]) {
    return null;
  }
  return { publicId: match[2], secret: match[4], claimCode: match[3] };
}

export async function verifyClaimTokenSecret(
  claimToken: string,
  expectedTokenHash: Uint8Array,
  pepper: string,
): Promise<boolean> {
  const parsed = parseClaimToken(claimToken);
  if (!parsed) {
    return false;
  }
  const computed = digestToBytes(await hmac(parsed.secret, pepper));
  if (computed.length !== expectedTokenHash.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < computed.length; index += 1) {
    diff |= (computed[index] ?? 0) ^ (expectedTokenHash[index] ?? 0);
  }
  return diff === 0;
}
