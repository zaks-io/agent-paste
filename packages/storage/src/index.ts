export {
  ARTIFACT_BYTES_AAD_VERSION,
  ARTIFACT_BYTES_BLOB_AAD_VERSION,
  ARTIFACT_BYTES_DERIVATION_INFO,
  ARTIFACT_BYTES_ENCRYPTION_ALG,
  ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES,
  ARTIFACT_BYTES_GCM_IV_BYTES,
  ARTIFACT_BYTES_GCM_TAG_BYTES,
  ARTIFACT_BYTES_METADATA_KEYS,
  type ArtifactBytesAadContext,
  type ArtifactBytesEncryptionMetadata,
  type ArtifactBytesKeyRing,
  type BlobArtifactBytesAadContext,
  bytesFromReadableBody,
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  composeArtifactBytesAad,
  decryptArtifactBytes,
  decryptArtifactBytesWithKeyRing,
  type EncryptedArtifactObject,
  encryptArtifactBytes,
  encryptionMetadataForKid,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  parseWorkspaceBlobObjectKey,
  plaintextByteLengthFromStoredObject,
  ReadableBodyTooLargeError,
  type RevisionArtifactBytesAadContext,
  type RevisionFileObjectKeyParts,
  type WorkspaceBlobObjectKeyParts,
  workspaceBlobObjectKeyFor,
} from "./artifact-bytes-encryption.js";
export {
  destWorkspaceBlobKey,
  migrateWorkspaceBlobForReparent,
  migrateWorkspaceBlobsForReparent,
  type WorkspaceBlobRef,
} from "./reparent-workspace-blobs.js";
export {
  type ApplyConflictReason,
  type ApplyUnifiedDiffResult,
  applyUnifiedDiff,
  decodeUtf8Strict,
} from "./unified-diff.js";
export {
  type ArtifactBytesSigningRing,
  type R2GetObjectBody,
  readRevisionFileObjectBytes,
  readWorkspaceBlobBytes,
  WorkspaceBlobMetadataError,
  WorkspaceBlobMissingError,
  type WorkspaceBlobR2,
  writeWorkspaceBlob,
} from "./workspace-blob-bytes.js";

export const MIME_TYPES_BY_EXTENSION = {
  ".css": "text/css; charset=utf-8",
  ".pdf": "application/pdf",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
} as const;

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export const TAILWIND_CDN_SCRIPT_SOURCE = "https://cdn.tailwindcss.com";

/**
 * Extensions that are recognized (so they get a real Content-Type) but must never
 * render inline. PDFs can carry embedded JavaScript and are a common phishing /
 * XSS vehicle in browser PDF viewers, so they download instead of opening in-page.
 * Audio/video stay inline: native media players can't execute script.
 */
const ATTACHMENT_EXTENSIONS = new Set<MimeExtension>([".pdf"]);

export const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:",
  "style-src 'self' 'unsafe-inline' data: blob: https:",
  "font-src 'self' data: blob: https:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' data: blob: https: wss:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob: https:",
  "frame-ancestors 'none'",
].join("; ");

function parseContentSecurityPolicyDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const segment of csp.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const spaceIndex = trimmed.search(/\s/u);
    directives.set(
      spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex),
      spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim(),
    );
  }
  return directives;
}

function contentSecurityPolicyDirectiveOrder(csp: string): string[] {
  return csp
    .split(";")
    .map((segment) => segment.trim().split(/\s+/u)[0])
    .filter((name): name is string => Boolean(name));
}

function serializeContentSecurityPolicy(order: string[], directives: Map<string, string>): string {
  return order
    .map((name) => {
      const value = directives.get(name);
      return value === undefined ? null : value.length > 0 ? `${name} ${value}` : name;
    })
    .filter((segment): segment is string => segment !== null)
    .join("; ");
}

export function deriveScriptDisabledContentSecurityPolicy(baseCsp: string): string {
  const directives = parseContentSecurityPolicyDirectives(baseCsp);
  directives.set("script-src", "'none'");
  return serializeContentSecurityPolicy(contentSecurityPolicyDirectiveOrder(baseCsp), directives);
}

export function withScriptSrcHash(
  csp: string,
  hashes: readonly string[],
  externalSources: readonly string[] = [],
): string {
  const directives = parseContentSecurityPolicyDirectives(csp);
  directives.set("script-src", [...hashes.map((hash) => `'sha256-${hash}'`), ...externalSources].join(" "));
  const order = contentSecurityPolicyDirectiveOrder(csp);
  if (!order.includes("script-src")) order.push("script-src");
  return serializeContentSecurityPolicy(order, directives);
}

export function withScriptSrcNonce(csp: string, nonce: string): string {
  const directives = parseContentSecurityPolicyDirectives(csp);
  directives.set("script-src", `'nonce-${nonce}'`);
  const order = contentSecurityPolicyDirectiveOrder(csp);
  if (!order.includes("script-src")) order.push("script-src");
  return serializeContentSecurityPolicy(order, directives);
}

export function withFrameAncestors(csp: string, ancestors: readonly string[]): string {
  const directives = parseContentSecurityPolicyDirectives(csp);
  directives.set("frame-ancestors", ancestors.length > 0 ? ancestors.join(" ") : "'none'");
  const order = contentSecurityPolicyDirectiveOrder(csp);
  if (!order.includes("frame-ancestors")) order.push("frame-ancestors");
  return serializeContentSecurityPolicy(order, directives);
}

export const SCRIPT_DISABLED_CONTENT_SECURITY_POLICY =
  deriveScriptDisabledContentSecurityPolicy(BASE_CONTENT_SECURITY_POLICY);
export const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export const CONTENT_SECURITY_HEADERS = {
  "Content-Security-Policy": BASE_CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export type MimeExtension = keyof typeof MIME_TYPES_BY_EXTENSION;
export type ContentDisposition = "inline" | "attachment";

export type ServedContent = {
  contentType: string;
  disposition: ContentDisposition;
  csp: string;
};

export function contentTypeForPath(path: string): string {
  const extension = path.match(/\.[^./\\]+$/u)?.[0]?.toLowerCase();
  if (extension !== undefined && extension in MIME_TYPES_BY_EXTENSION) {
    return MIME_TYPES_BY_EXTENSION[extension as MimeExtension];
  }

  return DEFAULT_MIME_TYPE;
}

export function servedContentForPath(
  path: string,
  options?: { scriptDisabled?: boolean; capability?: boolean },
): ServedContent {
  const extension = path.match(/\.[^./\\]+$/u)?.[0]?.toLowerCase();
  const contentType = contentTypeForPath(path);
  const baseCsp =
    options?.scriptDisabled && !options.capability
      ? SCRIPT_DISABLED_CONTENT_SECURITY_POLICY
      : BASE_CONTENT_SECURITY_POLICY;
  if (contentType === DEFAULT_MIME_TYPE) {
    return { contentType, disposition: "attachment", csp: baseCsp };
  }
  if (extension !== undefined && ATTACHMENT_EXTENSIONS.has(extension as MimeExtension)) {
    return { contentType, disposition: "attachment", csp: baseCsp };
  }
  if (extension === ".svg" && !options?.capability) {
    return { contentType, disposition: "inline", csp: SVG_CONTENT_SECURITY_POLICY };
  }
  return { contentType, disposition: "inline", csp: baseCsp };
}

export function attachmentFilename(path: string): string {
  const basename = path.split("/").at(-1) || "download";
  return basename.replaceAll(/["\\\r\n]/gu, "_");
}
