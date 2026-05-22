import { USAGE_POLICY } from "./policy.js";

export function validateUpload(files: Array<{ path: string; size_bytes: number }>, entrypoint = "index.html") {
  if (files.length === 0 || files.length > USAGE_POLICY.file_count_cap) {
    throw new Error("file_count_cap_exceeded");
  }
  let total = 0;
  for (const file of files) {
    if (file.size_bytes > USAGE_POLICY.file_size_cap_bytes) {
      throw new Error("file_size_cap_exceeded");
    }
    total += file.size_bytes;
  }
  if (total > USAGE_POLICY.artifact_size_cap_bytes) {
    throw new Error("revision_size_cap_exceeded");
  }
  if (!files.some((file) => file.path === entrypoint)) {
    throw new Error("entrypoint_not_in_revision");
  }
}

export function normalizeStoragePath(input: string) {
  const path = input.replaceAll("\\", "/");
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("invalid_request");
  }
  return path;
}

export function objectKeyFor(artifactId: string, revisionId: string, path: string) {
  return `artifacts/${artifactId}/revisions/${revisionId}/files/${path}`;
}

export function contentTypeForPath(path: string) {
  const extension = path.toLowerCase().split(".").pop();
  switch (extension) {
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
    case "mjs":
      return "application/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "md":
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
