import {
  ApiKeyId,
  CreateApiKeyRequest,
  type CreateApiKeyResponse,
  type LockdownDetail,
  LockdownScope,
  type RevokeApiKeyResponse,
  SetLockdownRequest,
  UpdateWebSettingsRequest,
  type WebSettingsResponse,
} from "@agent-paste/contracts";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { ApiError, type ApiErrorInfo, apiFetch } from "./api-client";
import { getRequestId } from "./runtime";

export type MutationResult<T> = { data: T; error: null } | { data: null; error: ApiErrorInfo };

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

export const createKeyFn = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string }) => input)
  .handler(({ data }) => {
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
  });

export const revokeKeyFn = createServerFn({ method: "POST" })
  .inputValidator((input: { apiKeyId: string }) => input)
  .handler(({ data }) => {
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
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { workspace_name: string; auto_deletion_days: number }) => input)
  .handler(({ data }) => {
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
  });

export const setLockdownFn = createServerFn({ method: "POST" })
  .inputValidator((input: { scope: string; target_id: string; reason_code: string }) => input)
  .handler(({ data }) => {
    const input = parseInput(SetLockdownRequest, data);
    if (input.error) return Promise.resolve({ data: null, error: input.error });
    return runMutation<LockdownDetail>((accessToken) =>
      apiFetch<LockdownDetail>("/v1/web/admin/lockdowns", {
        method: "POST",
        accessToken,
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input.value),
      }),
    );
  });

export const liftLockdownFn = createServerFn({ method: "POST" })
  .inputValidator((input: { scope: string; target_id: string }) => input)
  .handler(({ data }) => {
    const scope = parseInput(LockdownScope, data.scope);
    if (scope.error) return Promise.resolve({ data: null, error: scope.error });
    const targetId = data.target_id.trim();
    if (!targetId) {
      return Promise.resolve({
        data: null,
        error: {
          status: 400,
          code: "validation_error",
          message: "target_id is required.",
          requestId: undefined,
        },
      });
    }
    return runMutation<LockdownDetail>((accessToken) =>
      apiFetch<LockdownDetail>(
        `/v1/web/admin/lockdowns/${encodeURIComponent(scope.value)}/${encodeURIComponent(targetId)}`,
        {
          method: "DELETE",
          accessToken,
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      ),
    );
  });
