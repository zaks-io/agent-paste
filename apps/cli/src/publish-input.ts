import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentPasteError, type ApiClient, createIdempotencyKey, type PublishPlanInput } from "@agent-paste/api-client";
import { ArtifactReference, FilePath, PlainTextTitle } from "@agent-paste/contracts/primitives";
import { booleanFlag, type Parsed, repeatedFlag, stringFlag } from "./cli-args.js";
import { inferPublishOptions, validateFilesAgainstUsagePolicy } from "./local.js";
import { scanLocalPath } from "./local-scan.js";

export async function prepareGuardedPublish(parsed: Parsed, client: ApiClient) {
  const inputPath = parsed.positionals[0];
  const artifactFlag = stringFlag(parsed, "artifact-id");
  const artifactId = artifactFlag !== undefined ? parseReference(artifactFlag) : undefined;
  const toFlag = stringFlag(parsed, "to");
  const to = toFlag === undefined ? undefined : FilePath.parse(toFlag);
  const mirror = booleanFlag(parsed, "mirror", false);
  const deletions = repeatedFlag(parsed, "delete").map((p) => FilePath.parse(p));
  validatePublishFlags(parsed, inputPath, artifactId, to, mirror, deletions);
  const titleFlag = stringFlag(parsed, "title");
  const parsedTitle = titleFlag === undefined ? undefined : parseTitle(titleFlag);
  const entryFlag = stringFlag(parsed, "entrypoint");
  const parsedEntry = entryFlag === undefined ? undefined : FilePath.parse(entryFlag);
  let sources = inputPath ? await scanLocalPath(inputPath, repeatedFlag(parsed, "exclude")) : [];
  const stat = inputPath ? await fs.stat(path.resolve(inputPath)) : undefined;
  if (mirror && !stat?.isDirectory()) throw invalid("--mirror requires a directory");
  if (to) sources = sources.map((file) => ({ ...file, path: stat?.isDirectory() ? `${to}/${file.path}` : to }));
  let inferred: ReturnType<typeof inferPublishOptions> | undefined;
  try {
    inferred =
      !to && inputPath
        ? inferPublishOptions(inputPath, sources, { ...(parsedEntry ? { entrypoint: parsedEntry } : {}) })
        : undefined;
  } catch (error) {
    throw invalid((error as Error).message);
  }
  if (!artifactId && parsedEntry && !sources.some((f) => f.path === parsedEntry))
    throw invalid("Entrypoint was not found in the publish files");
  const policy = await client.usagePolicy();
  try {
    validateFilesAgainstUsagePolicy(sources, policy);
  } catch (error) {
    throw invalid((error as Error).message);
  }
  const base = artifactId ? await client.artifacts.getAgentView(artifactId) : undefined;
  const title = PlainTextTitle.parse(parsedTitle ?? base?.title ?? inferred?.title);
  const entrypoint = FilePath.parse(parsedEntry ?? (to || !inputPath ? base?.entrypoint : inferred?.entrypoint));
  const mode: PublishPlanInput["mode"] = mirror
    ? { kind: "mirror_prefix", prefix: to! }
    : to || !inputPath
      ? { kind: "paths" }
      : { kind: "tree" };
  const pin = parsed.flags.has("pin") ? booleanFlag(parsed, "pin", false) : undefined;
  const input: PublishPlanInput = {
    sources,
    title,
    entrypoint,
    mode,
    deletePaths: deletions,
    idempotencyKey: createIdempotencyKey("cli_publish"),
    ...(artifactId ? { artifactId } : {}),
    ...(pin !== undefined ? { pin } : {}),
  };
  return { inputPath, input, policy, base };
}

function invalid(message: string) {
  return new AgentPasteError({ code: "invalid_request", status: 400, message });
}
function parseTitle(value: string) {
  const result = PlainTextTitle.safeParse(value);
  if (!result.success) throw invalid("Invalid title");
  return result.data;
}
function parseReference(value: string) {
  const result = ArtifactReference.safeParse(value);
  if (!result.success) throw invalid("Invalid Artifact reference");
  return result.data;
}

function validatePublishFlags(
  parsed: Parsed,
  inputPath: string | undefined,
  artifactId: string | undefined,
  to: string | undefined,
  mirror: boolean,
  deletions: string[],
) {
  if (parsed.positionals.length > 1 || (!inputPath && !deletions.length))
    throw invalid("Provide one local path or --delete");
  if ((to || deletions.length || mirror) && !artifactId)
    throw invalid("--to, --mirror and --delete require --artifact-id");
  if (mirror && (!to || !inputPath)) throw invalid("--mirror requires a directory path and --to");
  if (deletions.length && inputPath && !to) throw invalid("Combine --delete with --to, or omit the local path");
  if (mirror && deletions.length) throw invalid("--mirror cannot be combined with --delete");
  if (stringFlag(parsed, "claim-code") !== undefined) throw invalid("--claim-code requires --ephemeral");
}
