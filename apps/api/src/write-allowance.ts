import {
  consumeWriteAllowance,
  getWriteAllowanceStatus,
  releaseWriteAllowance,
  type WriteAllowanceNamespace,
} from "@agent-paste/write-allowance";

export type WriteAllowanceBinding = WriteAllowanceNamespace;

export async function readWriteAllowanceRemaining(
  binding: WriteAllowanceBinding | undefined,
  workspaceId: string,
  limit: number,
): Promise<number | undefined> {
  const status = await getWriteAllowanceStatus(binding, workspaceId, limit);
  return status?.remaining;
}

export type WriteAllowanceOutcome =
  | { ok: true }
  | { ok: false; reason: "exceeded"; retryAfter: string }
  | { ok: false; reason: "unavailable" };

export async function enforceNewArtifactWriteAllowance(
  binding: WriteAllowanceBinding | undefined,
  workspaceId: string,
  limit: number,
  idempotencyKey?: string,
): Promise<WriteAllowanceOutcome> {
  // The allowance counter is a required enforcement dependency: a missing binding
  // means the gate is unconfigured, so fail closed rather than silently admitting
  // every publish.
  if (!binding) {
    return { ok: false, reason: "unavailable" };
  }
  const outcome = await consumeWriteAllowance(binding, workspaceId, limit, idempotencyKey);
  if (!outcome) {
    // Binding present but the counter could not be reached or returned an
    // unparseable response: still a dependency failure, not a free pass.
    return { ok: false, reason: "unavailable" };
  }
  if (!outcome.allowed) {
    return { ok: false, reason: "exceeded", retryAfter: String(outcome.retry_after_seconds) };
  }
  return { ok: true };
}

export async function releaseNewArtifactWriteAllowance(
  binding: WriteAllowanceBinding | undefined,
  workspaceId: string,
  idempotencyKey: string,
): Promise<void> {
  await releaseWriteAllowance(binding, workspaceId, idempotencyKey);
}
