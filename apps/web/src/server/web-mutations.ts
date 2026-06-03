import "@tanstack/react-start/server-only";

import {
  ApiKeyId,
  CreateApiKeyRequest,
  type CreateApiKeyResponse,
  EphemeralClaimRequest,
  type EphemeralClaimResponse,
  LiftLockdownRequest,
  type LockdownDetail,
  type RevokeApiKeyResponse,
  SetLockdownRequest,
  UpdateWebSettingsRequest,
  type WebSettingsResponse,
} from "@agent-paste/contracts";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import type { ApiErrorInfo, MutationResult } from "../lib/api-error";
import { ApiError, apiFetch } from "./api-client";
import { getRequestId } from "./runtime";
import { verifyTurnstileToken } from "./turnstile";

// Server functions are a trust boundary even though the API re-validates: parse the raw
// input against the canonical contract schema so malformed payloads never reach the
// upstream call. A parse failure becomes a 400 MutationResult rather than a rejection.
type SafeParser<T> = {
  safeParse: (
    input: unknown,
  ) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
};

function parseInput<T>(
  schema: SafeParser<T>,
  input: unknown,
): { value: T; error: null } | { value: null; error: ApiErrorInfo } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { value: parsed.data, error: null };
  return {
    value: null,
    error: {
      status: 400,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
      requestId: undefined,
    },
  };
}

async function runMutation<T>(invoke: (accessToken: string) => Promise<T>): Promise<MutationResult<T>> {
  const auth = await getAuth();
  if (!auth.user || !auth.accessToken) {
    return {
      data: null,
      error: { status: 401, code: "unauthorized", message: "Not signed in.", requestId: undefined },
    };
  }
  try {
    return { data: await invoke(auth.accessToken), error: null };
  } catch (err) {
    const requestId = getRequestId();
    if (err instanceof ApiError) {
      return {
        data: null,
        error: { status: err.status, code: err.code, message: err.message, requestId: err.requestId ?? requestId },
      };
    }
    return {
      data: null,
      error: {
        status: 0,
        code: "network_error",
        message: err instanceof Error ? err.message : "request failed",
        requestId,
      },
    };
  }
}

export function createKey(data: { name: string }): Promise<MutationResult<CreateApiKeyResponse>> {
  const input = parseInput(CreateApiKeyRequest, data);
  if (input.error) return Promise.resolve({ data: null, error: input.error });
  return runMutation<CreateApiKeyResponse>((accessToken) =>
    apiFetch<CreateApiKeyResponse>("/v1/web/keys", {
      method: "POST",
      accessToken,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input.value),
    }),
  );
}

export function revokeKey(data: { apiKeyId: string }): Promise<MutationResult<RevokeApiKeyResponse>> {
  const raw = (data as { apiKeyId?: unknown } | null | undefined)?.apiKeyId;
  const input = parseInput(ApiKeyId, raw);
  if (input.error) return Promise.resolve({ data: null, error: input.error });
  return runMutation<RevokeApiKeyResponse>((accessToken) =>
    apiFetch<RevokeApiKeyResponse>(`/v1/web/keys/${encodeURIComponent(input.value)}/revoke`, {
      method: "POST",
      accessToken,
      headers: { "idempotency-key": crypto.randomUUID() },
    }),
  );
}

export function saveSettings(data: {
  workspace_name: string;
  auto_deletion_days: number;
}): Promise<MutationResult<WebSettingsResponse>> {
  const input = parseInput(UpdateWebSettingsRequest, data);
  if (input.error) return Promise.resolve({ data: null, error: input.error });
  return runMutation<WebSettingsResponse>((accessToken) =>
    apiFetch<WebSettingsResponse>("/v1/web/settings", {
      method: "PATCH",
      accessToken,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input.value),
    }),
  );
}

export function setLockdown(data: {
  scope: string;
  target_id: string;
  reason_code: string;
}): Promise<MutationResult<LockdownDetail>> {
  const input = parseInput(SetLockdownRequest, data);
  if (input.error) return Promise.resolve({ data: null, error: input.error });
  const targetId = input.value.target_id.trim();
  if (targetId.length === 0) {
    return Promise.resolve({
      data: null,
      error: {
        status: 400,
        code: "validation_error",
        message: "Target ID is required.",
        requestId: undefined,
      },
    });
  }
  return runMutation<LockdownDetail>((accessToken) =>
    apiFetch<LockdownDetail>("/v1/web/admin/lockdowns", {
      method: "POST",
      accessToken,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ ...input.value, target_id: targetId }),
    }),
  );
}

export function liftLockdown(data: { scope: string; target_id?: string }): Promise<MutationResult<LockdownDetail>> {
  const input = parseInput(LiftLockdownRequest, data);
  if (input.error) return Promise.resolve({ data: null, error: input.error });
  const targetId = input.value.target_id.trim();
  if (targetId.length === 0) {
    return Promise.resolve({
      data: null,
      error: {
        status: 400,
        code: "validation_error",
        message: "Target ID is required.",
        requestId: undefined,
      },
    });
  }
  return runMutation<LockdownDetail>((accessToken) =>
    apiFetch<LockdownDetail>(
      `/v1/web/admin/lockdowns/${encodeURIComponent(input.value.scope)}/${encodeURIComponent(targetId)}`,
      {
        method: "DELETE",
        accessToken,
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    ),
  );
}

export async function claimEphemeral(data: {
  claim_token: string;
  turnstile_token: string;
}): Promise<MutationResult<EphemeralClaimResponse>> {
  const turnstileToken = typeof data.turnstile_token === "string" ? data.turnstile_token.trim() : "";
  if (!turnstileToken || turnstileToken.length > 2048) {
    return {
      data: null,
      error: {
        status: 400,
        code: "validation_error",
        message: "Invalid Turnstile token.",
        requestId: undefined,
      },
    };
  }

  const turnstileOk = await verifyTurnstileToken(turnstileToken);
  if (!turnstileOk) {
    return {
      data: null,
      error: {
        status: 400,
        code: "turnstile_failed",
        message: "Turnstile verification failed.",
        requestId: undefined,
      },
    };
  }

  const input = parseInput(EphemeralClaimRequest, { claim_token: data.claim_token });
  if (input.error) return { data: null, error: input.error };

  return runMutation<EphemeralClaimResponse>((accessToken) =>
    apiFetch<EphemeralClaimResponse>("/v1/ephemeral/claim", {
      method: "POST",
      accessToken,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input.value),
    }),
  );
}
