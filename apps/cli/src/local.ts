import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { inferRenderModeFromEntrypoint, Mebibytes, type RenderMode, type UsagePolicy } from "@agent-paste/contracts";
import { contentTypeForPath } from "@agent-paste/storage";

// Absolute per-file ceiling, matching the contract's hard maximum
// (UploadSessionFileInput.size_bytes) so no tier can ever accept a larger file.
// Checked from `stat` before the file is read, so an oversized file fails fast
// instead of being buffered into memory just to be rejected after the fact.
const MAX_FILE_BYTES = Mebibytes.twentyFive;

export type LocalFile = {
  absolutePath: string;
  path: string;
  sizeBytes: number;
};

export type PublishInference = {
  title: string;
  entrypoint: string;
  renderMode: RenderMode;
};

const entrypointCandidates = ["index.html", "index.md", "README.md"];

export async function walkLocalPath(inputPath: string): Promise<LocalFile[]> {
  const root = path.resolve(inputPath);
  const stat = await fs.stat(root);
  if (stat.isFile()) {
    return [await toLocalFile(root, path.basename(root))];
  }
  if (!stat.isDirectory()) {
    throw new Error(`${inputPath} is neither a file nor a directory`);
  }
  const files: LocalFile[] = [];
  await walkDirectory(root, root, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function inferPublishOptions(
  inputPath: string,
  files: LocalFile[],
  overrides: Partial<PublishInference> = {},
): PublishInference {
  const title = overrides.title ?? path.basename(path.resolve(inputPath));
  const entrypoint = overrides.entrypoint ?? inferEntrypoint(files);
  const renderMode = overrides.renderMode ?? inferRenderMode(entrypoint);
  return { title, entrypoint, renderMode };
}

export function validateFilesAgainstUsagePolicy(files: LocalFile[], policy: UsagePolicy) {
  if (files.length > policy.file_count_cap) {
    throw new Error(`File count ${files.length} exceeds cap ${policy.file_count_cap}`);
  }
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (total > policy.artifact_size_cap_bytes) {
    throw new Error(`Artifact size ${total} exceeds cap ${policy.artifact_size_cap_bytes}`);
  }
  const oversized = files.find((file) => file.sizeBytes > policy.file_size_cap_bytes);
  if (oversized) {
    throw new Error(`File ${oversized.path} size ${oversized.sizeBytes} exceeds cap ${policy.file_size_cap_bytes}`);
  }
}

export function contentTypeForLocalPath(filePath: string): string {
  return contentTypeForPath(filePath);
}

function inferEntrypoint(files: LocalFile[]) {
  for (const candidate of entrypointCandidates) {
    if (files.some((file) => file.path === candidate)) {
      return candidate;
    }
  }
  if (files.length === 1) {
    const onlyFile = files[0];
    if (!onlyFile) {
      throw new Error("No files found to publish");
    }
    return onlyFile.path;
  }
  throw new Error("Could not infer entrypoint. Pass --entrypoint <path>.");
}

// Shared map with the server (contracts) so what the CLI predicts is what the
// server stores. Unlike the server (which falls back to html for unknown
// extensions), the CLI refuses to guess and asks for an explicit flag.
function inferRenderMode(entrypoint: string): RenderMode {
  const mode = inferRenderModeFromEntrypoint(entrypoint);
  if (!mode) {
    throw new Error(`Could not infer render mode for ${entrypoint}. Pass --render-mode <mode>.`);
  }
  return mode;
}

async function walkDirectory(root: string, current: string, files: LocalFile[]) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (isExcluded(entry.name)) {
      continue;
    }
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, files);
    } else if (entry.isFile()) {
      files.push(await toLocalFile(absolutePath, path.relative(root, absolutePath).split(path.sep).join("/")));
    }
  }
}

async function toLocalFile(absolutePath: string, relativePath: string): Promise<LocalFile> {
  const { size } = await fs.stat(absolutePath);
  if (size > MAX_FILE_BYTES) {
    throw new Error(`File ${relativePath} is ${size} bytes, which exceeds the ${MAX_FILE_BYTES}-byte per-file limit`);
  }
  return {
    absolutePath,
    path: relativePath,
    sizeBytes: size,
  };
}

export type LocalFileDigest = {
  sha256: string;
  sizeBytes: number;
};

export async function sha256HexForFile(absolutePath: string): Promise<LocalFileDigest> {
  const hash = createHash("sha256");
  const handle = await fs.open(absolutePath, "r");
  let sizeBytes = 0;
  try {
    const chunk = new Uint8Array(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
      sizeBytes += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

// True iff the bytes are valid UTF-8. Mirrors the storage decodeUtf8Strict
// round-trip check (decode then re-encode), so the CLI's text/binary decision
// matches what the server's diff applier accepts (ADR 0090). Binary files
// are uploaded whole; only text files are diffed.
export function isUtf8Text(bytes: Uint8Array): boolean {
  const reencoded = new TextEncoder().encode(new TextDecoder().decode(bytes));
  if (reencoded.length !== bytes.length) {
    return false;
  }
  for (let i = 0; i < bytes.length; i++) {
    if (reencoded[i] !== bytes[i]) {
      return false;
    }
  }
  return true;
}

function isExcluded(name: string) {
  return (
    name === ".git" || name === "node_modules" || name === ".DS_Store" || name === ".env" || name.startsWith(".env.")
  );
}
