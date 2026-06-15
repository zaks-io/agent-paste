import { promises as fs } from "node:fs";
import path from "node:path";
import { RevisionId } from "@agent-paste/contracts";
import { configDir } from "./credentials.js";

// Per-artifact record of what the CLI last published, so a revise can diff the
// working dir against it and send only changed/added files + deleted_paths against
// base_revision_id (ADR 0090). Holds only paths, plaintext sha256, sizes,
// and the base revision id — no bytes, no secrets. A stale or corrupt cache can
// never cause a bad publish: the server re-validates base_revision_id and every
// patch base at finalize, and the revise path drops the cache and re-publishes
// whole on any base-unusable error.

export type ManifestCacheFile = { path: string; sha256: string; size_bytes: number };
export type ManifestCache = { revision_id: string; files: ManifestCacheFile[] };

function manifestsDir(): string {
  return path.join(configDir(), "manifests");
}

export function manifestCachePath(artifactId: string): string {
  return path.join(manifestsDir(), `${encodeURIComponent(artifactId)}.json`);
}

// Validate the on-disk shape ourselves: any drift (older/newer CLI, hand-edit,
// truncation) is treated as a cache miss so the next publish is a correct full
// publish rather than a stale-base patch attempt.
function parseManifestCache(raw: string): ManifestCache | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { revision_id?: unknown; files?: unknown };
  // revision_id must be a well-formed id; a bad one (drift/corruption) is a cache
  // miss so the next publish is a clean full publish, not a guaranteed bad base.
  const revision = RevisionId.safeParse(candidate.revision_id);
  if (!revision.success || !Array.isArray(candidate.files)) {
    return null;
  }
  const files: ManifestCacheFile[] = [];
  for (const file of candidate.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof (file as ManifestCacheFile).path !== "string" ||
      typeof (file as ManifestCacheFile).sha256 !== "string" ||
      typeof (file as ManifestCacheFile).size_bytes !== "number"
    ) {
      return null;
    }
    const f = file as ManifestCacheFile;
    files.push({ path: f.path, sha256: f.sha256, size_bytes: f.size_bytes });
  }
  return { revision_id: revision.data, files };
}

export async function loadManifestCache(artifactId: string): Promise<ManifestCache | null> {
  try {
    return parseManifestCache(await fs.readFile(manifestCachePath(artifactId), "utf8"));
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveManifestCache(artifactId: string, cache: ManifestCache): Promise<void> {
  await fs.mkdir(manifestsDir(), { recursive: true, mode: 0o700 });
  const filePath = manifestCachePath(artifactId);
  await rejectSymlink(filePath);
  await fs.writeFile(filePath, JSON.stringify(cache), { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

async function rejectSymlink(filePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write manifest cache through symlink: ${filePath}`);
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
