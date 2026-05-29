import type { Principal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "../src/env.js";

export const workspaceId = "00000000-0000-4000-8000-000000000001";

export const apiActor = {
  type: "api_key",
  id: "key_1",
  workspace_id: workspaceId,
  scopes: ["publish", "read", "admin"],
};

export const memberActor = {
  type: "member",
  id: "mem_1",
  email: "member@example.com",
  workspace_id: workspaceId,
  scopes: ["publish", "read", "admin"],
};

export function apiPrincipal(actor: Record<string, unknown> = apiActor): Principal {
  return { kind: "api_key", actor } as Principal;
}

export function memberPrincipal(identity: Record<string, unknown> = {}): Principal {
  return {
    kind: "workos_access_token",
    actor: memberActor,
    identity: { workos_user_id: "user_1", email: "member@example.com", ...identity },
  } as Principal;
}

export function operatorPrincipal(id = "operator@example.com"): Principal {
  return { kind: "operator", actor: { type: "platform", id } } as Principal;
}

export function nonePrincipal(): Principal {
  return { kind: "none" };
}

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
  const request = new Request(input.url ?? "https://api.test/v1/test", {
    method: input.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });
  const params = input.params ?? {};
  return {
    env: input.env ?? {},
    req: {
      raw: request,
      param(name: string) {
        return params[name];
      },
    },
    get() {
      return "req_test_12345678";
    },
  } as unknown as AppContext;
}

export function guardFor(body: unknown = {}, idempotencyKey = "idem_1") {
  return { body, idempotencyKey } as never;
}

export async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
