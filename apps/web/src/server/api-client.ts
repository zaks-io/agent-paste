import "@tanstack/react-start/server-only";
import type { LoaderFallback } from "../lib/api-error";
import { getRequestId, getWebEnv } from "./runtime";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type ApiFetchOptions = RequestInit & {
  accessToken?: string;
};

const ABSENT_DATA_STATUSES = new Set([404, 501]);
const API_FETCH_TIMEOUT_MS = 8_000;

function resolveApiUrl(path: string): string {
  const env = getWebEnv();
  const base = env.API_BASE_URL.replace(/\/$/, "");
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

async function dispatch(input: string, init: RequestInit): Promise<Response> {
  const env = getWebEnv();
  const timeoutSignal = AbortSignal.timeout(API_FETCH_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const requestInit = { ...init, signal };
  if (env.API) {
    return env.API.fetch(new Request(input, requestInit));
  }
  return fetch(input, requestInit);
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;
  const requestId = getRequestId();

  const finalHeaders = new Headers(headers);
  finalHeaders.set("accept", "application/json");
  finalHeaders.set("x-request-id", requestId);
  if (!finalHeaders.has("content-type") && rest.body) {
    finalHeaders.set("content-type", "application/json");
  }
  if (accessToken) {
    finalHeaders.set("authorization", `Bearer ${accessToken}`);
  }

  const url = resolveApiUrl(path);
  const response = await dispatch(url, { ...rest, headers: finalHeaders });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(
        response.status,
        "invalid_response",
        `non-JSON response from api (${response.status})`,
        requestId,
      );
    }
  }

  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string; request_id?: string } } | null;
    const code = envelope?.error?.code ?? `http_${response.status}`;
    const message = envelope?.error?.message ?? response.statusText ?? "request failed";
    throw new ApiError(response.status, code, message, envelope?.error?.request_id ?? requestId);
  }

  return parsed as T;
}

export async function apiFetchOrEmpty<T>(path: string, options: ApiFetchOptions = {}): Promise<LoaderFallback<T>> {
  const requestId = getRequestId();
  try {
    const data = await apiFetch<T>(path, options);
    return { data, empty: false, error: null };
  } catch (err) {
    if (err instanceof ApiError && ABSENT_DATA_STATUSES.has(err.status)) {
      return { data: null, empty: true, error: null };
    }
    if (err instanceof ApiError) {
      return {
        data: null,
        empty: false,
        error: {
          status: err.status,
          code: err.code,
          message: err.message,
          requestId: err.requestId ?? requestId,
        },
      };
    }
    return {
      data: null,
      empty: false,
      error: {
        status: 0,
        code: "network_error",
        message: err instanceof Error ? err.message : "request failed",
        requestId,
      },
    };
  }
}
