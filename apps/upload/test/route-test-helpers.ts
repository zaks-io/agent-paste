import { REQUEST_ID_CONTEXT_KEY } from "@agent-paste/auth";
import { BOUND_RESPONDERS_KEY, createBoundResponders } from "@agent-paste/worker-runtime";
import type { Context } from "hono";
import type { AppContext, Env } from "../src/env.js";

export function contextFor(
  input: {
    url?: string;
    method?: string;
    headers?: HeadersInit;
    body?: unknown;
    env?: Env;
    params?: Record<string, string | undefined>;
  } = {},
): AppContext {
  const headers = new Headers(input.headers);
  let body: BodyInit | undefined;
  if (input.body !== undefined) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  const request = new Request(input.url ?? "https://upload.test/v1/test", {
    method: input.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });
  const params = input.params ?? {};
  const env = input.env ?? {};
  const stub = {
    env,
    req: {
      raw: request,
      param(name: string) {
        return params[name];
      },
    },
    get(key: string) {
      if (key === REQUEST_ID_CONTEXT_KEY) {
        return "req_test_12345678";
      }
      if (key === BOUND_RESPONDERS_KEY) {
        return boundResponders;
      }
      return undefined;
    },
  };
  const boundResponders = createBoundResponders(stub as Context, {
    docsBaseUrl: env.DOCS_BASE_URL,
  });
  return stub as unknown as AppContext;
}

export function guardFor(body: unknown = {}, idempotencyKey = "idem_1") {
  return { body, idempotencyKey } as never;
}

export async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
