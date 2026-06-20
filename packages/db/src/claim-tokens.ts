import { base64UrlDecode, hmac } from "@agent-paste/tokens/crypto";
import { base64UrlEncode, randomCrockford } from "./id.js";

export type GeneratedClaimToken = {
  secret: string;
  publicId: string;
  tokenHash: Uint8Array;
};

type ParsedClaimToken = {
  publicId: string;
  secret: string;
  claimCode?: string;
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
  const embeddedClaimCode = claimCode && CLAIM_CODE_PATTERN.test(claimCode) ? claimCode : undefined;
  const claimCodeSegment = embeddedClaimCode ? `.${embeddedClaimCode}` : "";
  const parsed: ParsedClaimToken = {
    publicId,
    secret: secretSegment,
    ...(embeddedClaimCode ? { claimCode: embeddedClaimCode } : {}),
  };
  return {
    secret: `ap_ct_${env}_${publicId}${claimCodeSegment}_${secretSegment}`,
    publicId,
    tokenHash: digestToBytes(await hmac(claimTokenMacInput(parsed), pepper)),
  };
}

export function parseClaimToken(value: string): ParsedClaimToken | null {
  const match = value.match(CLAIM_TOKEN_PATTERN);
  if (!match?.[2] || !match[4]) {
    return null;
  }
  return {
    publicId: match[2],
    secret: match[4],
    ...(match[3] ? { claimCode: match[3] } : {}),
  };
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
  const macInputs = [claimTokenMacInput(parsed)];
  if (!parsed.claimCode) {
    macInputs.push(parsed.secret);
  }
  for (const input of macInputs) {
    if (constantTimeEquals(digestToBytes(await hmac(input, pepper)), expectedTokenHash)) {
      return true;
    }
  }
  return false;
}

function claimTokenMacInput(parsed: ParsedClaimToken): string {
  return `${parsed.publicId}.${parsed.claimCode ?? ""}.${parsed.secret}`;
}

function constantTimeEquals(computed: Uint8Array, expected: Uint8Array): boolean {
  if (computed.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < computed.length; index += 1) {
    diff |= (computed[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return diff === 0;
}
