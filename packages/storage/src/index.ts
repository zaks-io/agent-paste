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

/**
 * Extensions that are recognized (so they get a real Content-Type) but must never
 * render inline. PDFs can carry embedded JavaScript and are a common phishing /
 * XSS vehicle in browser PDF viewers, so they download instead of opening in-page.
 * Audio/video stay inline: native media players can't execute script.
 */
const ATTACHMENT_EXTENSIONS = new Set<MimeExtension>([".pdf"]);

export const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function parseContentSecurityPolicyDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const segment of csp.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const spaceIndex = trimmed.search(/\s/u);
    if (spaceIndex === -1) {
      directives.set(trimmed, "");
      continue;
    }
    directives.set(trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1).trim());
  }
  return directives;
}

function contentSecurityPolicyDirectiveOrder(csp: string): string[] {
  const order: string[] = [];
  for (const segment of csp.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const name = trimmed.split(/\s+/u)[0];
    if (name) {
      order.push(name);
    }
  }
  return order;
}

function serializeContentSecurityPolicy(order: string[], directives: Map<string, string>): string {
  return order
    .map((name) => {
      const value = directives.get(name);
      if (value === undefined) {
        return null;
      }
      return value.length > 0 ? `${name} ${value}` : name;
    })
    .filter((segment): segment is string => segment !== null)
    .join("; ");
}

/** Derives the ephemeral script-disabled policy from the base policy by disabling script execution only. */
export function deriveScriptDisabledContentSecurityPolicy(baseCsp: string): string {
  const directives = parseContentSecurityPolicyDirectives(baseCsp);
  directives.set("script-src", "'none'");
  return serializeContentSecurityPolicy(contentSecurityPolicyDirectiveOrder(baseCsp), directives);
}

/**
 * Replaces `script-src` with a single nonce source so one trusted inline script
 * (for example the viewer resize reporter) may run while publisher scripts stay
 * blocked.
 */
export function withScriptSrcNonce(csp: string, nonce: string): string {
  const directives = parseContentSecurityPolicyDirectives(csp);
  directives.set("script-src", `'nonce-${nonce}'`);
  return serializeContentSecurityPolicy(contentSecurityPolicyDirectiveOrder(csp), directives);
}

/**
 * Rewrites the `frame-ancestors` directive so the trusted app origin(s) may frame
 * this otherwise-locked content. The served HTML is still sandboxed by the viewer
 * (`sandbox="allow-scripts"`, no `allow-same-origin`); this only relaxes which page
 * may host that sandbox. An empty list restores `frame-ancestors 'none'`.
 */
export function withFrameAncestors(csp: string, ancestors: readonly string[]): string {
  const directives = parseContentSecurityPolicyDirectives(csp);
  directives.set("frame-ancestors", ancestors.length > 0 ? ancestors.join(" ") : "'none'");
  // Always emit the directive: callers that relax framing also drop X-Frame-Options,
  // so an absent frame-ancestors would otherwise leave the content frameable by all.
  const order = contentSecurityPolicyDirectiveOrder(csp);
  if (!order.includes("frame-ancestors")) {
    order.push("frame-ancestors");
  }
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

export function servedContentForPath(path: string, options?: { scriptDisabled?: boolean }): ServedContent {
  const extension = path.match(/\.[^./\\]+$/u)?.[0]?.toLowerCase();
  const contentType = contentTypeForPath(path);
  const scriptDisabled = options?.scriptDisabled === true;
  const baseCsp = scriptDisabled ? SCRIPT_DISABLED_CONTENT_SECURITY_POLICY : BASE_CONTENT_SECURITY_POLICY;
  if (contentType === DEFAULT_MIME_TYPE) {
    return { contentType, disposition: "attachment", csp: baseCsp };
  }
  if (extension !== undefined && ATTACHMENT_EXTENSIONS.has(extension as MimeExtension)) {
    return { contentType, disposition: "attachment", csp: baseCsp };
  }
  if (extension === ".svg") {
    return { contentType, disposition: "inline", csp: SVG_CONTENT_SECURITY_POLICY };
  }
  return { contentType, disposition: "inline", csp: baseCsp };
}

export function attachmentFilename(path: string): string {
  const basename = path.split("/").at(-1) || "download";
  return basename.replaceAll(/["\\\r\n]/gu, "_");
}
