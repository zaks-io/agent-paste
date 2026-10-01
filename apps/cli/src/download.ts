import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentPasteError, type ApiClient } from "@agent-paste/api-client";
import type { AgentView } from "@agent-paste/contracts/agent-view";
import { ArtifactReference } from "@agent-paste/contracts/primitives";
import { output, outputModeFor, type Parsed, requiredArg, stringFlag } from "./cli-args.js";
import { isNotFound } from "./fs-errors.js";
import { formatBytes, type OutputMode, paint } from "./render.js";

// Bundles are generated asynchronously after publish, so a download right after
// publish usually finds one pending. Wait briefly rather than failing.
const BUNDLE_WAIT_MS = 60_000;

type ReadyBundle = Extract<AgentView["bundle"], { status: "ready" }>;

export type DownloadClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const systemClock: DownloadClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type DownloadResult = {
  artifact_id: string;
  revision_id: string;
  title: string;
  path: string;
  size_bytes: number;
};

export async function download(parsed: Parsed, client: ApiClient, clock: DownloadClock = systemClock) {
  const artifactReference = ArtifactReference.parse(requiredArg(parsed, 0, "artifact-id"));
  const revisionId = stringFlag(parsed, "revision-id");
  const view = revisionId
    ? await client.artifacts.getRevisionAgentView(artifactReference, revisionId)
    : await client.artifacts.getAgentView(artifactReference);
  const target = path.resolve(stringFlag(parsed, "output") ?? `${view.artifact_id}.zip`);
  await assertWritableTarget(target);

  const bundle = await waitForBundle(client, view, clock);
  const bytes = await client.downloadSignedUrl(bundle.url);
  await writeNewFile(target, bytes);

  const result: DownloadResult = {
    artifact_id: view.artifact_id,
    revision_id: view.revision_id,
    title: view.title,
    path: target,
    size_bytes: bytes.byteLength,
  };
  return output(result, parsed.global, formatDownloadResult(outputModeFor(parsed.global), result));
}

async function waitForBundle(client: ApiClient, initial: AgentView, clock: DownloadClock): Promise<ReadyBundle> {
  const deadline = clock.now() + BUNDLE_WAIT_MS;
  let view = initial;
  for (;;) {
    const { bundle } = view;
    switch (bundle.status) {
      case "ready":
        return bundle;
      case "failed":
        throw new Error(
          `The bundle for revision ${view.revision_id} failed to generate. Use pull to read files one at a time.`,
        );
      case "disabled":
        throw new Error(`Bundles are disabled for revision ${view.revision_id}.`);
      case "pending": {
        const waitMs = bundle.retry_after_seconds * 1000;
        if (clock.now() + waitMs > deadline) {
          throw new AgentPasteError({
            code: "bundle_pending",
            message: `The bundle for revision ${view.revision_id} is still being built. Retry shortly.`,
            status: 503,
            retryAfterSeconds: bundle.retry_after_seconds,
          });
        }
        await clock.sleep(waitMs);
        view = await client.artifacts.getRevisionAgentView(view.artifact_id, view.revision_id);
      }
    }
  }
}

// Checked before waiting and downloading so a bad --output fails in seconds.
async function assertWritableTarget(target: string): Promise<void> {
  const directory = path.dirname(target);
  const stat = await fs.stat(directory).catch((error: unknown) => {
    if (isNotFound(error)) {
      throw new Error(`${directory} does not exist. Create it or pass a different --output.`);
    }
    throw error;
  });
  if (!stat.isDirectory()) {
    throw new Error(`${directory} is not a directory.`);
  }
  try {
    await fs.lstat(target);
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
  throw alreadyExists(target);
}

// "wx" makes the no-overwrite promise atomic even if the file appears while we wait.
async function writeNewFile(target: string, bytes: Uint8Array): Promise<void> {
  try {
    await fs.writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") {
      throw alreadyExists(target);
    }
    await fs.rm(target, { force: true });
    throw error;
  }
}

function alreadyExists(target: string): Error {
  return new Error(`${target} already exists. Pass --output <path> to write somewhere else.`);
}

function formatDownloadResult(mode: OutputMode, result: DownloadResult): string {
  const label = (text: string) => paint(mode, "dim", text);
  return [
    `${paint(mode, "green", "✓")} Downloaded ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    `  ${label("Saved")}     ${result.path}`,
    `  ${label("Size")}      ${formatBytes(result.size_bytes)}`,
    `  ${label("Revision")}  ${result.revision_id}`,
  ].join("\n");
}
