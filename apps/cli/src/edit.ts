import { promises as fs } from "node:fs";
import { type ApiClient, createIdempotencyKey, runPublish as runSharedPublish } from "@agent-paste/api-client";
import { ArtifactId, FilePath, McpEdit } from "@agent-paste/contracts";
import { type Edit, ReviseError, reviseOnePath } from "@agent-paste/revise-core";
import { output, outputModeFor, type Parsed, requiredArg, shellQuote, stringFlag } from "./cli-args.js";
import { formatEditNoop, formatPublishResult } from "./publish-format.js";
import { apiClientTransport } from "./publish-transport.js";
import { apiClientReader } from "./revision-reader.js";
import { commandInvocation, detectChannel } from "./update-check.js";

export async function edit(parsed: Parsed, client: ApiClient) {
  const artifactId = ArtifactId.parse(requiredArg(parsed, 0, "artifact-id"));
  const filePath = FilePath.parse(requiredArg(parsed, 1, "path"));
  const edits = await readEdits(parsed);

  const result = await reviseOnePath(
    { reader: apiClientReader(client), transport: apiClientTransport(client), publish: runSharedPublish },
    { artifactId, path: filePath, edits, idempotencyKey: createIdempotencyKey("cli_edit") },
  );

  const mode = outputModeFor(parsed.global);
  if (result.noop) {
    const payload = {
      artifact_id: artifactId,
      noop: true,
      title: result.base.title,
      private_url: result.base.private_url,
    };
    return output(payload, parsed.global, formatEditNoop(mode, payload));
  }
  const shaped = {
    ...result.outcome.result,
    upload_stats: {
      total_files: result.outcome.uploadStats.totalFiles,
      total_bytes: result.outcome.uploadStats.totalBytes,
      uploaded_files: result.outcome.uploadStats.uploadedFiles,
      uploaded_bytes: result.outcome.uploadStats.uploadedBytes,
      reused_files: result.outcome.uploadStats.reusedFiles,
      reused_bytes: result.outcome.uploadStats.reusedBytes,
    },
  };
  // Teach the revise verb at the moment the agent holds the id: the next edit reuses
  // the same artifact_id so the open page live-updates instead of stranding on a new link.
  const updateCommand = commandInvocation(
    detectChannel(),
    `edit ${result.outcome.result.artifact_id} ${shellQuote(filePath)}`,
  );
  return output(shaped, parsed.global, formatPublishResult(mode, shaped, updateCommand));
}

// Read the edits JSON: --edits <file> when given, else stdin. Parsed and validated
// against the shared edit contract (old_string/new_string/replace_all), then mapped to
// the engine's camelCase Edit. A bad payload throws a validation error before any network.
export async function readEdits(parsed: Parsed): Promise<Edit[]> {
  const editsFile = stringFlag(parsed, "edits");
  // Without --edits we read stdin, which only ends on EOF. At an interactive TTY
  // there is no EOF, so the process would hang silently — fail loud instead.
  if (!editsFile && process.stdin.isTTY) {
    throw new Error(
      "edit: provide --edits <file> or pipe a JSON array of { old_string, new_string, replace_all? } on stdin",
    );
  }
  const raw = editsFile ? await fs.readFile(editsFile, "utf8") : await readStdin();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throwEditContractError("edit: --edits / stdin must be a JSON array of { old_string, new_string, replace_all? }");
  }
  const validated = McpEdit.array().min(1).max(100).safeParse(json);
  if (!validated.success) {
    const emptyOldString = validated.error.issues.find(
      (issue) =>
        issue.code === "too_small" &&
        issue.path.length >= 2 &&
        issue.path[1] === "old_string" &&
        typeof issue.path[0] === "number",
    );
    if (emptyOldString && typeof emptyOldString.path[0] === "number") {
      const index = emptyOldString.path[0];
      throwEditContractError(`edit ${index} empty_old_string`, index);
    }
    throwEditContractError(
      "edit: invalid edits — expected a non-empty JSON array of { old_string, new_string, replace_all? }",
    );
  }
  return validated.data.map((e) => ({
    oldString: e.old_string,
    newString: e.new_string,
    ...(e.replace_all === true ? { replaceAll: true } : {}),
  }));
}

/** Pre-network edit payload failures use ReviseError so render.ts buckets them as exit 4 / invalid_edit. */
function throwEditContractError(message: string, editIndex?: number): never {
  throw new ReviseError("empty_old_string", message, editIndex);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = "";
    process.stdin.on("data", (chunk) => {
      text += decoder.decode(chunk, { stream: true });
    });
    process.stdin.on("end", () => {
      text += decoder.decode();
      resolve(text);
    });
    process.stdin.on("error", reject);
  });
}
