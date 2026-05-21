export const LOCAL_DATA_DIR = ".agent-paste";
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PATH_SEGMENTS = 64;
export const MAX_PATH_LENGTH = 512;
export const DEFAULT_ACCESS_LINK_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CLEANUP_BATCH_SIZE = 100;

export type NormalizedPath = {
  path: string;
  segments: string[];
};

export function normalizeStoragePath(input: string): NormalizedPath {
  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.some((segment) => segment === "..")) {
    throw new Error("Storage paths cannot traverse upward.");
  }

  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new Error(`Storage paths cannot exceed ${MAX_PATH_SEGMENTS} segments.`);
  }

  const path = segments.join("/");
  if (path.length === 0) {
    throw new Error("Storage paths cannot be empty.");
  }

  if (path.length > MAX_PATH_LENGTH) {
    throw new Error(`Storage paths cannot exceed ${MAX_PATH_LENGTH} characters.`);
  }

  return { path, segments };
}

export function isExpired(expiresAt: string | undefined, now = new Date()): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= now.getTime();
}
