import {
  consumeWriteAllowance,
  getWriteAllowanceStatus,
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

export async function enforceNewArtifactWriteAllowance(
  binding: WriteAllowanceBinding | undefined,
  workspaceId: string,
  limit: number,
  idempotencyKey?: string,
): Promise<{ ok: true } | { ok: false; retryAfter: string }> {
  const outcome = await consumeWriteAllowance(binding, workspaceId, limit, idempotencyKey);
  if (!outcome) {
    return { ok: true };
  }
  if (!outcome.allowed) {
    return { ok: false, retryAfter: String(outcome.retry_after_seconds) };
  }
  return { ok: true };
}
