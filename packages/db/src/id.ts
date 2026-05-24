export { base64UrlEncode } from "@agent-paste/tokens/crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createId(prefix: string) {
  return `${prefix}_${randomCrockford(26)}`;
}

export function randomCrockford(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte: number) => CROCKFORD[byte % CROCKFORD.length]).join("");
}
