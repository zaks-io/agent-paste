import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { UsagePolicy } from "@agent-paste/contracts";

export type LocalFile = {
  absolutePath: string;
  path: string;
  sizeBytes: number;
  sha256: string;
};

export type PublishInference = {
  title: string;
  entrypoint: string;
  renderMode: "html" | "markdown" | "text" | "image" | "audio" | "video";
};

const entrypointCandidates = ["index.html", "index.md", "README.md"];
const renderModesByExtension = new Map<string, PublishInference["renderMode"]>([
  [".html", "html"],
  [".htm", "html"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".text", "text"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".mp4", "video"],
  [".webm", "video"],
  [".mov", "video"],
]);

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

export function parseTtlSeconds(input: string): number {
  const trimmed = input.trim();
  const match = /^(?<amount>\d+)(?<unit>s|m|h|d|w)?$/i.exec(trimmed);
  if (!match?.groups) {
    throw new Error("TTL must look like 30m, 12h, 7d, or a plain second count");
  }
  const amountText = match.groups.amount;
  if (!amountText) {
    throw new Error("TTL must include an amount");
  }
  const amount = Number.parseInt(amountText, 10);
  const unit = (match.groups.unit ?? "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unsupported TTL unit ${unit}`);
  }
  return amount * multiplier;
}

export function expiresAtFromTtl(ttl: string, now = new Date(), capDays?: number): string {
  const seconds = parseTtlSeconds(ttl);
  if (capDays !== undefined && seconds > capDays * 86_400) {
    throw new Error(`TTL exceeds workspace cap of ${capDays} days`);
  }
  return new Date(now.getTime() + seconds * 1000).toISOString();
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
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
    case ".markdown":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
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

function inferRenderMode(entrypoint: string): PublishInference["renderMode"] {
  const mode = renderModesByExtension.get(path.extname(entrypoint).toLowerCase());
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
  const bytes = await fs.readFile(absolutePath);
  return {
    absolutePath,
    path: relativePath,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function isExcluded(name: string) {
  return (
    name === ".git" || name === "node_modules" || name === ".DS_Store" || name === ".env" || name.startsWith(".env.")
  );
}
