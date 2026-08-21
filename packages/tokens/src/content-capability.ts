const CONTENT_CAPABILITY_BYTES = 16;
const CONTENT_CAPABILITY_ID_PATTERN = /^[a-f0-9]{32}$/;
const CONTENT_CAPABILITY_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_CONTENT_CAPABILITY_DOMAIN_LENGTH = 217;
const CONTENT_CAPABILITY_HOST_SUFFIX = "-uc";
const CONTENT_CAPABILITY_PREFIX = "content-capabilities/v1";
const MAX_CONTENT_CAPABILITY_TOKEN_LENGTH = 64 * 1024;
const MAX_CONTENT_CAPABILITY_ENTRYPOINT_LENGTH = 4 * 1024;

export type ContentCapabilityManifest = {
  version: 1;
  signed_token: string;
  entrypoint: string;
};

export function mintContentCapabilityId(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(CONTENT_CAPABILITY_BYTES));
  if (bytes.byteLength !== CONTENT_CAPABILITY_BYTES) {
    throw new Error(`Content capability IDs require exactly ${CONTENT_CAPABILITY_BYTES} random bytes.`);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isContentCapabilityId(value: string): boolean {
  return CONTENT_CAPABILITY_ID_PATTERN.test(value);
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

export function contentCapabilityIdFromHostname(hostname: string, domain: string): string | null {
  const suffix = `${CONTENT_CAPABILITY_HOST_SUFFIX}.${parseContentCapabilityDomain(domain)}`;
  const normalizedHostname = hostname.toLowerCase();
  if (!normalizedHostname.endsWith(suffix)) {
    return null;
  }
  const capabilityId = normalizedHostname.slice(0, -suffix.length);
  return isContentCapabilityId(capabilityId) ? capabilityId : null;
}

export function isContentCapabilityHostname(hostname: string, domain: string): boolean {
  return hostname.toLowerCase().endsWith(`${CONTENT_CAPABILITY_HOST_SUFFIX}.${parseContentCapabilityDomain(domain)}`);
}

export function contentCapabilityHostname(capabilityId: string, domain: string): string {
  if (!isContentCapabilityId(capabilityId)) {
    throw new Error("Invalid content capability ID.");
  }
  return `${capabilityId}${CONTENT_CAPABILITY_HOST_SUFFIX}.${parseContentCapabilityDomain(domain)}`;
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
    !manifest.entrypoint.startsWith("/")
  );
}
