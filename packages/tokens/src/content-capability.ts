const CONTENT_CAPABILITY_BYTES = 19;
const CONTENT_CAPABILITY_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const NEW_CONTENT_CAPABILITY_ID_PATTERN = /^[0-9a-hj-kmnp-tv-z]{5}(?:-[0-9a-hj-kmnp-tv-z]{5}){3}$/;
const LEGACY_CONTENT_CAPABILITY_ID_PATTERN = /^[a-f0-9]{32}$/;
export const CONTENT_CAPABILITY_ID_PATTERN_SOURCE: string =
  "(?:[a-f0-9]{32}|[0-9a-hj-kmnp-tv-z]{5}(?:-[0-9a-hj-kmnp-tv-z]{5}){3})";
const CONTENT_CAPABILITY_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_CONTENT_CAPABILITY_DOMAIN_LENGTH = 217;
const CONTENT_CAPABILITY_HOST_SUFFIX_PATTERN = /^(?:-[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?)?$/;
const CONTENT_CAPABILITY_PREFIX = "content-capabilities/v1";
const MAX_CONTENT_CAPABILITY_TOKEN_LENGTH = 64 * 1024;
const MAX_CONTENT_CAPABILITY_ENTRYPOINT_LENGTH = 4 * 1024;

export type ContentCapabilityManifest = {
  version: 1;
  signed_token: string;
  entrypoint: string;
  revision_number: number;
  artifact_updated_at: string;
};

export function mintContentCapabilityId(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(CONTENT_CAPABILITY_BYTES));
  if (bytes.byteLength !== CONTENT_CAPABILITY_BYTES) {
    throw new Error(`Content capability IDs require exactly ${CONTENT_CAPABILITY_BYTES} random bytes.`);
  }
  const randomSymbols = Array.from(bytes, (byte) => CONTENT_CAPABILITY_ALPHABET[byte & 31]).join("");
  const checkSymbol = CONTENT_CAPABILITY_ALPHABET[contentCapabilityCheckValue(randomSymbols)];
  const symbols = `${randomSymbols}${checkSymbol}`;
  return `${symbols.slice(0, 5)}-${symbols.slice(5, 10)}-${symbols.slice(10, 15)}-${symbols.slice(15)}`;
}

export function isContentCapabilityId(value: string): boolean {
  // Legacy hex stays accepted because published URLs are permanent; the check symbol lets the edge reject typos and truncation before an R2 read.
  if (LEGACY_CONTENT_CAPABILITY_ID_PATTERN.test(value)) {
    return true;
  }
  if (!NEW_CONTENT_CAPABILITY_ID_PATTERN.test(value)) {
    return false;
  }
  const symbols = value.replaceAll("-", "");
  return CONTENT_CAPABILITY_ALPHABET.indexOf(symbols[19] ?? "") === contentCapabilityCheckValue(symbols.slice(0, 19));
}

function contentCapabilityCheckValue(symbols: string): number {
  return Array.from(symbols).reduce(
    (sum, symbol, index) => (sum + CONTENT_CAPABILITY_ALPHABET.indexOf(symbol) * (index % 2 === 0 ? 1 : 3)) % 32,
    0,
  );
}

export function contentCapabilityObjectKey(capabilityId: string): string {
  if (!isContentCapabilityId(capabilityId)) {
    throw new Error("Invalid content capability ID.");
  }
  return `${CONTENT_CAPABILITY_PREFIX}/${capabilityId}.json`;
}

export function parseContentCapabilityDomain(value: string): string {
  if (value.length > MAX_CONTENT_CAPABILITY_DOMAIN_LENGTH || !CONTENT_CAPABILITY_DOMAIN_PATTERN.test(value)) {
    throw new Error("CONTENT_CAPABILITY_DOMAIN must be a lowercase DNS hostname without a scheme, port, or wildcard.");
  }
  return value;
}

export function parseContentCapabilityHostSuffix(value: string | undefined): string {
  const suffix = value ?? "";
  if (!CONTENT_CAPABILITY_HOST_SUFFIX_PATTERN.test(suffix)) {
    throw new Error("CONTENT_CAPABILITY_HOST_SUFFIX must be empty or a lowercase DNS-label suffix beginning with '-'.");
  }
  return suffix;
}

export function contentCapabilityIdFromHostname(hostname: string, domain: string, hostSuffix?: string): string | null {
  const suffix = `${parseContentCapabilityHostSuffix(hostSuffix)}.${parseContentCapabilityDomain(domain)}`;
  const normalizedHostname = hostname.toLowerCase();
  if (!normalizedHostname.endsWith(suffix)) {
    return null;
  }
  const capabilityId = normalizedHostname.slice(0, -suffix.length);
  return isContentCapabilityId(capabilityId) ? capabilityId : null;
}

export function isContentCapabilityHostname(hostname: string, domain: string, hostSuffix?: string): boolean {
  return contentCapabilityIdFromHostname(hostname, domain, hostSuffix) !== null;
}

export function contentCapabilityHostname(capabilityId: string, domain: string, hostSuffix?: string): string {
  if (!isContentCapabilityId(capabilityId)) {
    throw new Error("Invalid content capability ID.");
  }
  const hostname = `${capabilityId}${parseContentCapabilityHostSuffix(hostSuffix)}.${parseContentCapabilityDomain(domain)}`;
  if (hostname.length > 253) {
    throw new Error("Content capability hostname exceeds the DNS length limit.");
  }
  return hostname;
}

export function serializeContentCapabilityManifest(manifest: ContentCapabilityManifest): string {
  if (!isContentCapabilityManifest(manifest)) {
    throw new Error("Invalid content capability manifest.");
  }
  return JSON.stringify(manifest);
}

export function parseContentCapabilityManifest(value: string): ContentCapabilityManifest | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isContentCapabilityManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isContentCapabilityManifest(value: unknown): value is ContentCapabilityManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const manifest = value as Partial<ContentCapabilityManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.signed_token === "string" &&
    manifest.signed_token.length > 0 &&
    manifest.signed_token.length <= MAX_CONTENT_CAPABILITY_TOKEN_LENGTH &&
    typeof manifest.entrypoint === "string" &&
    manifest.entrypoint.length > 0 &&
    manifest.entrypoint.length <= MAX_CONTENT_CAPABILITY_ENTRYPOINT_LENGTH &&
    !manifest.entrypoint.startsWith("/") &&
    Number.isSafeInteger(manifest.revision_number) &&
    Number(manifest.revision_number) > 0 &&
    typeof manifest.artifact_updated_at === "string" &&
    Number.isFinite(Date.parse(manifest.artifact_updated_at))
  );
}
