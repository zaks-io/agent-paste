import type { PublishFile, PublishInput, PublishOutcome, PublishTransport } from "@agent-paste/api-client/publish";
import type {
  AgentView,
  ArtifactFileContent,
  ArtifactId,
  IdempotencyKey,
  RenderMode,
  RevisionId,
  Sha256Hex,
} from "@agent-paste/contracts";
import { contentTypeForPath } from "@agent-paste/storage";
import { type ApplyEditsFailure, applyEdits, type Edit } from "./apply-edits.js";
import { diffWithSelfCheck } from "./unified-diff-gen.js";

/**
 * The read-side seam, twin of `PublishTransport`. The CLI implements it over its
 * HTTPS `ApiClient`; MCP implements it over Worker service bindings. Both have a
 * real adapter, so the interface passes the deletion test.
 */
export type RevisionReader = {
  /** Resolve the base revision's identity (revision_id, entrypoint, title) from the Agent View. */
  readArtifact(artifactId: string): Promise<AgentView>;
  /** Return a stored file's decrypted plaintext + sha256 (ADR 0090). */
  readFile(artifactId: string, path: string, revisionId?: string): Promise<ArtifactFileContent>;
};

/**
 * A typed, agent-visible revise failure. These are hard errors — the engine never
 * silently papers over them with a whole-blob upload (ADR 0091 strict fail-fast).
 */
export class ReviseError extends Error {
  constructor(
    readonly reason: ReviseFailureReason,
    message: string,
    readonly editIndex?: number,
  ) {
    super(message);
    this.name = "ReviseError";
  }
}

export type ReviseFailureReason =
  | ApplyEditsFailure // edit did not match the base
  | "base_not_text" // binary or oversize base: no inline body to diff
  | "path_not_in_base"; // target path is not in the base revision's tree

/** Injected so revise-core stays a type-only dependent of api-client (Worker-safe). */
export type ReviseDeps = {
  reader: RevisionReader;
  transport: PublishTransport;
  publish: (transport: PublishTransport, input: PublishInput) => Promise<PublishOutcome>;
};

export type ReviseEditsInput = {
  artifactId: string;
  path: string;
  edits: Edit[];
  idempotencyKey: IdempotencyKey;
  /** Optional explicit mode; omitted => inherits the base revision's mode at finalize. */
  renderMode?: RenderMode;
};

export type ReviseWholeBodyInput = {
  artifactId: string;
  path: string;
  nextText: string;
  idempotencyKey: IdempotencyKey;
  renderMode?: RenderMode;
};

export type ReviseResult =
  | { ok: true; noop: false; outcome: PublishOutcome }
  /**
   * The edited content equals the stored content (sha256 equal): no revision minted.
   * Carries the base it read so a caller can echo the stable link/title without a
   * second read.
   */
  | { ok: true; noop: true; base: AgentView };

/**
 * Apply literal edits to one stored file and publish the result as a verified patch
 * revise. Reads the base, applies the edits, diffs, and publishes a partial-manifest
 * revision (only this path changes; every other path inherits from the base). Strict:
 * a non-matching edit, a binary/oversize base, or a missing path all throw `ReviseError`.
 */
export async function reviseOnePath(deps: ReviseDeps, input: ReviseEditsInput): Promise<ReviseResult> {
  return revise(deps, input.artifactId, input.path, input.idempotencyKey, input.renderMode, (baseBody) => {
    const applied = applyEdits(baseBody, input.edits);
    if (!applied.ok) {
      throw new ReviseError(applied.reason, `edit ${applied.index} ${applied.reason}`, applied.index);
    }
    return applied.body;
  });
}

/**
 * Replace one stored file's whole body and publish the result as a verified patch
 * revise when the byte content actually changed. Used by MCP `add_revision` when the
 * call's entrypoint matches the base (the incremental-revise path). Same strict base
 * checks as `reviseOnePath`, minus the edit-application step.
 */
export async function reviseWholeBody(deps: ReviseDeps, input: ReviseWholeBodyInput): Promise<ReviseResult> {
  return revise(deps, input.artifactId, input.path, input.idempotencyKey, input.renderMode, () => input.nextText);
}

// Shared orchestration: read base -> compute next text -> diff -> publish under the
// base revision. The only difference between the edit and whole-body paths is how
// `nextText` is produced, so it is the one injected step. A finalize `patch_conflict`
// means the base moved under us (TOCTOU): re-read and re-apply against the fresh base
// exactly once. A stale edit then surfaces as its typed `ReviseError`.
async function revise(
  deps: ReviseDeps,
  artifactId: string,
  path: string,
  idempotencyKey: IdempotencyKey,
  renderMode: RenderMode | undefined,
  computeNextText: (baseBody: string) => string,
): Promise<ReviseResult> {
  const attempt = () => reviseAttempt(deps, artifactId, path, idempotencyKey, renderMode, computeNextText);
  try {
    return await attempt();
  } catch (error) {
    if (!isPatchConflict(error)) {
      throw error;
    }
    return attempt();
  }
}

async function reviseAttempt(
  deps: ReviseDeps,
  artifactId: string,
  path: string,
  idempotencyKey: IdempotencyKey,
  renderMode: RenderMode | undefined,
  computeNextText: (baseBody: string) => string,
): Promise<ReviseResult> {
  const base = await deps.reader.readArtifact(artifactId);
  if (!base.files.some((file) => file.path === path)) {
    throw new ReviseError("path_not_in_base", `${path}: not in the base revision`);
  }

  const file = await deps.reader.readFile(artifactId, path, base.revision_id);
  if (file.is_binary || file.body === undefined) {
    throw new ReviseError("base_not_text", `${path}: base is binary or too large to edit`);
  }

  const nextText = computeNextText(file.body);
  const nextBytes = new TextEncoder().encode(nextText);
  const resultSha256 = await sha256Hex(nextBytes);
  if (resultSha256 === file.sha256) {
    return { ok: true, noop: true, base };
  }

  const publishInput = await buildPublishInput({
    artifactId,
    base,
    path,
    file,
    baseText: file.body,
    nextText,
    nextBytes,
    resultSha256,
    idempotencyKey,
    renderMode,
  });
  return { ok: true, noop: false, outcome: await deps.publish(deps.transport, publishInput) };
}

async function buildPublishInput(input: {
  artifactId: string;
  base: AgentView;
  path: string;
  file: ArtifactFileContent;
  baseText: string;
  nextText: string;
  nextBytes: Uint8Array;
  resultSha256: string;
  idempotencyKey: IdempotencyKey;
  renderMode: RenderMode | undefined;
}): Promise<PublishInput> {
  const { base, path, file, baseText, nextText, nextBytes, resultSha256 } = input;
  const contentType = contentTypeForPath(path);
  const diff = await diffWithSelfCheck({
    baseText,
    baseSha256: file.sha256,
    nextText,
    nextBytes,
    expectedResultSha256: resultSha256,
  });

  // A verified diff that is smaller goes as a patch; otherwise the whole file, still
  // under base_revision_id (the result is sha256-verified at finalize, so this is not
  // a conflict swallow — it is the one legitimate fallback in ADR 0091).
  const resultSha = resultSha256 as Sha256Hex;
  const entry: PublishFile = diff
    ? {
        path,
        sizeBytes: diff.byteLength,
        sha256: resultSha,
        contentType,
        read: () => diff,
        patch: { baseSha256: file.sha256, resultSha256: resultSha },
      }
    : {
        path,
        sizeBytes: nextBytes.byteLength,
        sha256: resultSha,
        contentType,
        read: () => nextBytes,
      };

  return {
    files: [entry],
    title: base.title,
    entrypoint: base.entrypoint,
    artifactId: input.artifactId as ArtifactId,
    baseRevisionId: base.revision_id as RevisionId,
    idempotencyKey: input.idempotencyKey,
    ...(input.renderMode ? { renderMode: input.renderMode } : {}),
  };
}

// A finalize patch failure surfaces as wire code `patch_conflict` or a message
// containing it (ADR 0090 collapses some base-* kinds to invalid_request with the
// kind in the message). We only retry the genuine "base moved" conflict; the
// other base-* kinds mean "abandon the partial manifest", which the edit path does
// not do — it re-reads and re-applies instead.
function isPatchConflict(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === "patch_conflict") {
    return true;
  }
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message.includes("patch_conflict");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
