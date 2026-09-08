import { AgentPasteError } from "@agent-paste/api-client";
import { ArtifactId, FilePath, PlainTextTitle, RenderMode, type UsagePolicy } from "@agent-paste/contracts";
import { type Parsed, requiredArg, stringFlag } from "./cli-args.js";
import {
  inferPublishOptions,
  type LocalFile,
  sha256HexForFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import type { LocalFileWithDigest } from "./revise.js";

export type PublishPreflight = {
  inputPath: string;
  files: LocalFile[];
  inferred: ReturnType<typeof inferPublishOptions>;
  artifactId: ArtifactId | undefined;
  explicitRenderMode: RenderMode | undefined;
  usagePolicy: UsagePolicy;
};

export type PreparedPublish = Omit<PublishPreflight, "files"> & { files: LocalFileWithDigest[] };

type PreparePublishOptions = {
  allowArtifactId: boolean;
  resolveExistingTitle?: (artifactId: ArtifactId) => Promise<string>;
} & (
  | { usagePolicy: UsagePolicy; resolveUsagePolicy?: never }
  | { usagePolicy?: never; resolveUsagePolicy: () => Promise<UsagePolicy> }
);

export async function preparePublish(parsed: Parsed, options: PreparePublishOptions): Promise<PublishPreflight> {
  const inputPath = requiredArg(parsed, 0, "path");
  const artifactIdFlag = stringFlag(parsed, "artifact-id");
  if (!options.allowArtifactId && artifactIdFlag !== undefined) {
    throw invalidRequest("--artifact-id cannot be used with --ephemeral");
  }
  if (options.allowArtifactId && stringFlag(parsed, "claim-code") !== undefined) {
    throw invalidRequest("--claim-code requires --ephemeral");
  }
  const artifactId = artifactIdFlag ? parseArtifactId(artifactIdFlag) : undefined;
  const renderModeFlag = stringFlag(parsed, "render-mode");
  const explicitRenderMode = renderModeFlag === undefined ? undefined : parseRenderMode(renderModeFlag);
  const titleFlag = stringFlag(parsed, "title");
  const parsedTitle = titleFlag === undefined ? undefined : parseTitle(titleFlag);
  const rawEntrypoint = stringFlag(parsed, "entrypoint");
  const entrypoint = rawEntrypoint === undefined ? undefined : parseFilePath(rawEntrypoint, "entrypoint");
  const files = await walkLocalPath(inputPath);
  if (entrypoint !== undefined && !files.some((file) => file.path === entrypoint)) {
    throw invalidRequest("Entrypoint was not found in the publish files");
  }

  const usagePolicy = options.usagePolicy ?? (await options.resolveUsagePolicy());
  validatePublishUsage(files, usagePolicy);

  const existingTitle =
    titleFlag === undefined && artifactId && options.resolveExistingTitle
      ? await options.resolveExistingTitle(artifactId)
      : undefined;
  const titleOverride = parsedTitle ?? existingTitle;

  let inferred: ReturnType<typeof inferPublishOptions>;
  try {
    inferred = inferPublishOptions(inputPath, files, {
      ...(titleOverride !== undefined ? { title: titleOverride } : {}),
      ...(entrypoint !== undefined ? { entrypoint } : {}),
      ...(explicitRenderMode !== undefined ? { renderMode: explicitRenderMode } : {}),
    });
  } catch (error) {
    throw invalidRequest(error instanceof Error ? error.message : String(error));
  }
  inferred = {
    ...inferred,
    title: parseTitle(inferred.title),
    entrypoint: parseFilePath(inferred.entrypoint, "entrypoint"),
  };

  return { inputPath, files, inferred, artifactId, explicitRenderMode, usagePolicy };
}

export async function digestPublish(preflight: PublishPreflight): Promise<PreparedPublish> {
  const files = await Promise.all(
    preflight.files.map(async (file): Promise<LocalFileWithDigest> => {
      const digest = await sha256HexForFile(file.absolutePath);
      return { ...file, sha256: digest.sha256, sizeBytes: digest.sizeBytes };
    }),
  );
  return { ...preflight, files };
}

export function validatePublishUsage(files: LocalFile[], policy: UsagePolicy): void {
  try {
    validateFilesAgainstUsagePolicy(files, policy);
  } catch (error) {
    throw invalidRequest(error instanceof Error ? error.message : String(error));
  }
}

function parseArtifactId(value: string): ArtifactId {
  const parsed = ArtifactId.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest("--artifact-id is not a valid Artifact ID");
  }
  return parsed.data;
}

function parseRenderMode(value: string): RenderMode {
  const parsed = RenderMode.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest("Unsupported render mode");
  }
  return parsed.data;
}

function parseFilePath(value: string, label: string): FilePath {
  const parsed = FilePath.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(`${label} ${parsed.error.issues[0]?.message ?? "is invalid"}`);
  }
  return parsed.data;
}

function parseTitle(value: string): string {
  const parsed = PlainTextTitle.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(`title ${parsed.error.issues[0]?.message ?? "is invalid"}`);
  }
  return parsed.data;
}

function invalidRequest(message: string): AgentPasteError {
  return new AgentPasteError({ code: "invalid_request", message, status: 400 });
}
