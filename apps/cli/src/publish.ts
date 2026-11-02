import {
  AgentPasteError,
  type ApiClient,
  createIdempotencyKey,
  executePublish,
  type PublishPlanInput,
  planPublish,
} from "@agent-paste/api-client";
import { PlainTextTitle } from "@agent-paste/contracts/primitives";
import { booleanFlag, output, outputModeFor, type Parsed, repeatedFlag, shellQuote } from "./cli-args.js";
import { artifactUpdateReference, formatPublishResult } from "./publish-format.js";
import { prepareGuardedPublish } from "./publish-input.js";
import type { PreparedPublish } from "./publish-preflight.js";
import { apiClientTransport } from "./publish-transport.js";
import { createProgress, type OutputMode } from "./render.js";
import { publishStateFor, restorePlan, type SavedPublish, serializePlan } from "./transfer-state.js";
import { commandInvocation, detectChannel } from "./update-check.js";

export async function publish(parsed: Parsed, client: ApiClient): Promise<void> {
  const { input, policy, base } = await prepareGuardedPublish(parsed, client);
  const { sources, mode } = input;
  const transport = apiClientTransport(client);
  const dryRun = booleanFlag(parsed, "dry-run", false);
  if (dryRun && booleanFlag(parsed, "restart", false)) throw invalid("--restart cannot be combined with --dry-run");
  const fresh = await planPublish(transport, input);
  if (dryRun)
    return output(
      {
        mode: mode.kind,
        head_revision_id: fresh.headRevisionId,
        ...fresh.changes,
        unchanged: fresh.unchanged,
        bytes_to_send_max: fresh.bytesToSendMax,
        limits: policy,
        usage: await client.usage.get(),
      },
      parsed.global,
    );
  const state = await publishStateFor(parsed, client, input);
  if (booleanFlag(parsed, "restart", false)) await state.remove();
  const loaded = await state.load();
  let plan = loaded ? restorePlan(loaded, sources) : fresh;
  if (loaded) {
    input.title = loaded.title;
    input.entrypoint = loaded.entrypoint;
  }
  if (!loaded && fresh.noChange && base) {
    const current =
      base.revision_id === fresh.headRevisionId
        ? base
        : await client.artifacts.getRevisionAgentView(base.artifact_id, fresh.headRevisionId!);
    return output(
      { ...baseResult(current), mode: mode.kind, no_change: true, changes: fresh.changes, upload_stats: emptyStats() },
      parsed.global,
      `${current.url}\nNo changes.`,
    );
  }
  const newSaved = (key: string): SavedPublish => ({
    key,
    title: input.title,
    entrypoint: input.entrypoint,
    sources: sources.map(({ readRange: _readRange, ...source }) => source),
    plan: serializePlan(plan),
  });
  let saved: SavedPublish = loaded ?? newSaved(input.idempotencyKey);
  await state.save(saved);
  const progress = createProgress(outputModeFor(parsed.global));
  const run = async () =>
    executePublish(transport, plan, {
      ...input,
      idempotencyKey: saved.key as PublishPlanInput["idempotencyKey"],
      ...(saved.state ? { state: saved.state } : {}),
      saveState: async (transfer) => {
        saved.state = transfer;
        await state.save(saved);
      },
      onProgress: ({ uploadedFiles, totalToUpload, uploadedBytes }) =>
        progress.update({ done: uploadedFiles, total: totalToUpload, bytes: uploadedBytes }),
    });
  let outcome: Awaited<ReturnType<typeof executePublish>>;
  try {
    outcome = await run();
  } catch (error) {
    if (!isLegacyInheritance(error) || mode.kind !== "tree") {
      if (isLegacyInheritance(error))
        throw invalid(
          "Selected paths cannot inherit this legacy Revision. Run an explicit full-tree mirror from a complete local tree.",
        );
      throw error;
    }
    // A whole-tree invocation already authorizes this exact scope. Re-send local
    // unchanged entries so no legacy revision-scoped row needs to be inherited.
    plan = { ...plan, upserts: sources, bytesToSendMax: sources.reduce((n, f) => n + f.sizeBytes, 0) };
    saved = newSaved(createIdempotencyKey("cli_mirror"));
    await state.save(saved);
    outcome = await run();
  } finally {
    progress.done();
  }
  await state.remove();
  const result = { ...outcome.result, mode: mode.kind, upload_stats: wireStats(outcome.uploadStats) };
  const update = publishUpdateCommand(parsed, result);

  return output(result, parsed.global, formatPublishResult(outputModeFor(parsed.global), result, update));
}
export async function runPreparedPublish(client: ApiClient, _mode: OutputMode, prepared: PreparedPublish) {
  const input: PublishPlanInput = {
    sources: prepared.files,
    title: PlainTextTitle.parse(prepared.inferred.title),
    entrypoint: prepared.inferred.entrypoint,
    mode: { kind: "tree" },
    idempotencyKey: createIdempotencyKey("cli_publish"),
  };
  const t = apiClientTransport(client);
  const outcome = await executePublish(t, await planPublish(t, input), input);
  return { ...outcome.result, mode: "tree", upload_stats: wireStats(outcome.uploadStats) };
}
function invalid(message: string) {
  return new AgentPasteError({ code: "invalid_request", status: 400, message });
}
function isLegacyInheritance(error: unknown): boolean {
  return (
    error instanceof AgentPasteError &&
    (error.message.includes("inherited_path_not_blob_backed") ||
      JSON.stringify(error.details ?? {}).includes("inherited_path_not_blob_backed"))
  );
}
function baseResult(base: Awaited<ReturnType<ApiClient["artifacts"]["getAgentView"]>>) {
  return {
    artifact_id: base.artifact_id,
    revision_id: base.revision_id,
    title: base.title,
    url: base.url,
    expires_at: base.expires_at,
    retention: base.retention,
    effective_expires_at: base.effective_expires_at,
  };
}
function emptyStats() {
  return { total_files: 0, total_bytes: 0, uploaded_files: 0, uploaded_bytes: 0, reused_files: 0, reused_bytes: 0 };
}
function wireStats(s: {
  totalFiles: number;
  totalBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
  reusedFiles: number;
  reusedBytes: number;
}) {
  return {
    total_files: s.totalFiles,
    total_bytes: s.totalBytes,
    uploaded_files: s.uploadedFiles,
    uploaded_bytes: s.uploadedBytes,
    reused_files: s.reusedFiles,
    reused_bytes: s.reusedBytes,
  };
}

function publishUpdateCommand(parsed: Parsed, result: Parameters<typeof artifactUpdateReference>[0]): string {
  const args = [
    "publish",
    ...parsed.positionals.map(shellQuote),
    "--artifact-id",
    shellQuote(artifactUpdateReference(result)),
  ];
  for (const flag of ["to", "delete", "exclude", "title", "entrypoint"]) {
    for (const value of repeatedFlag(parsed, flag)) args.push(`--${flag}`, shellQuote(value));
  }
  for (const flag of ["mirror", "pin"]) if (booleanFlag(parsed, flag, false)) args.push(`--${flag}`);
  return commandInvocation(detectChannel(), args.join(" "));
}
