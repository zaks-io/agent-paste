const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createId(prefix: string) {
  return `${prefix}_${randomCrockford(26)}`;
}

export function randomCrockford(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte: number) => CROCKFORD[byte % CROCKFORD.length]).join("");
}

export function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
