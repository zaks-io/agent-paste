import type { CreateApiKeyResponse, RevokeApiKeyResponse, WebSettingsResponse } from "@agent-paste/contracts";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { ApiError, type ApiErrorInfo, apiFetch } from "./api-client";
import { getRequestId } from "./runtime";

export type MutationResult<T> = { data: T; error: null } | { data: null; error: ApiErrorInfo };

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
  .handler(({ data }) =>
    runMutation<CreateApiKeyResponse>((accessToken) =>
      apiFetch<CreateApiKeyResponse>("/v1/web/keys", {
        method: "POST",
        accessToken,
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: data.name }),
      }),
    ),
  );

export const revokeKeyFn = createServerFn({ method: "POST" })
  .inputValidator((input: { apiKeyId: string }) => input)
  .handler(({ data }) =>
    runMutation<RevokeApiKeyResponse>((accessToken) =>
      apiFetch<RevokeApiKeyResponse>(`/v1/web/keys/${encodeURIComponent(data.apiKeyId)}/revoke`, {
        method: "POST",
        accessToken,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    ),
  );

export const saveSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { workspace_name: string; auto_deletion_days: number }) => input)
  .handler(({ data }) =>
    runMutation<WebSettingsResponse>((accessToken) =>
      apiFetch<WebSettingsResponse>("/v1/web/settings", {
        method: "PATCH",
        accessToken,
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(data),
      }),
    ),
  );
