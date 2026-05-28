export {
  ARTIFACT_BYTES_AAD_VERSION,
  ARTIFACT_BYTES_DERIVATION_INFO,
  ARTIFACT_BYTES_ENCRYPTION_ALG,
  ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES,
  ARTIFACT_BYTES_GCM_IV_BYTES,
  ARTIFACT_BYTES_GCM_TAG_BYTES,
  ARTIFACT_BYTES_METADATA_KEYS,
  type ArtifactBytesAadContext,
  type ArtifactBytesEncryptionMetadata,
  type ArtifactBytesKeyRing,
  bytesFromReadableBody,
  ciphertextByteLengthForPlaintext,
  composeArtifactBytesAad,
  decryptArtifactBytes,
  decryptArtifactBytesWithKeyRing,
  type EncryptedArtifactObject,
  encryptArtifactBytes,
  encryptionMetadataForKid,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  plaintextByteLengthFromStoredObject,
  type RevisionFileObjectKeyParts,
} from "./artifact-bytes-encryption.js";

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

export const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh",
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

export function servedContentForPath(path: string): ServedContent {
  const extension = path.match(/\.[^./\\]+$/u)?.[0]?.toLowerCase();
  const contentType = contentTypeForPath(path);
  if (contentType === DEFAULT_MIME_TYPE) {
    return { contentType, disposition: "attachment", csp: BASE_CONTENT_SECURITY_POLICY };
  }
  if (extension === ".svg") {
    return { contentType, disposition: "inline", csp: SVG_CONTENT_SECURITY_POLICY };
  }
  return { contentType, disposition: "inline", csp: BASE_CONTENT_SECURITY_POLICY };
}

export function attachmentFilename(path: string): string {
  const basename = path.split("/").at(-1) || "download";
  return basename.replaceAll(/["\\\r\n]/gu, "_");
}

export function responseHeadersForPath(path: string, extra: Record<string, string> = {}): Record<string, string> {
  const served = servedContentForPath(path);
  return {
    ...CONTENT_SECURITY_HEADERS,
    "Content-Type": served.contentType,
    "Content-Security-Policy": served.csp,
    ...(served.disposition === "attachment"
      ? { "Content-Disposition": `attachment; filename="${attachmentFilename(path)}"` }
      : {}),
    ...extra,
  };
}
