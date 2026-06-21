import { createHash, webcrypto } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateClaimCode(now = Date.now(), random = cryptoRandom): string {
  return `clm_${encodeCrockford(now, 10)}${random(16)}`;
}

export function generateDeterministicClaimCode(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  return `clm_${encodeBytes(digest, 26)}`;
}

export function isClaimCode(value: string): boolean {
  return /^clm_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function encodeCrockford(value: number, length: number): string {
  let remaining = Math.max(0, Math.floor(value));
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = ALPHABET.charAt(remaining % 32) + output;
    remaining = Math.floor(remaining / 32);
  }
  return output;
}

function cryptoRandom(length: number): string {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET.charAt(byte % 32)).join("");
}

function encodeBytes(bytes: Uint8Array, length: number): string {
  return Array.from(bytes.slice(0, length), (byte) => ALPHABET.charAt(byte % 32)).join("");
}
