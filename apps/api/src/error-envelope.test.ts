import { IdempotencyInFlightError } from "@agent-paste/commands";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest as rawHandleRequest } from "./index.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type EnvelopeBody = {
  error: { code: string; message: string; request_id: string; docs?: string };
};

function workspaceDb(): NonNullable<Env["DB"]> {
  return {
    async getWhoami(actor) {
      return { actor };
    },
    async getAgentView() {
      return null;
    },
    async getPublicAgentView() {
      return null;
    },
    async runCleanup() {
      return {};
    },
    async getWebMemberByWorkOsUserId() {
      return {
        type: "member",
        id: "mem_1",
        workspace_id: "w_1",
        scopes: ["admin"],
      };
    },
  };
}

function authStub(): NonNullable<Env["AUTH"]> {
  return {
    async verifyApiKey() {
      return { type: "api_key", id: "key_1", workspace_id: "w_1" };
    },
    async verifyWebToken() {
      return { workos_user_id: "user_1", email: "user@example.com", token_id: "jti_1", role: "admin" };
    },
  };
}

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP" | "ARTIFACT_RATE_LIMIT"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  return rawHandleRequest(request, { ...allowRateLimits(), ...env });
}

async function expectEnvelope(response: Response, code: string): Promise<EnvelopeBody> {
  const headerId = response.headers.get("x-request-id");
  expect(headerId).toMatch(REQUEST_ID_PATTERN);
  const body = (await response.json()) as EnvelopeBody;
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.request_id).toBe(headerId);
  return body;
}

describe("api error envelope", () => {
  it("404 envelope carries request_id and matching header", async () => {
    const response = await handleRequest(new Request("https://api.test/missing"), { DB: workspaceDb() });
    expect(response.status).toBe(404);
    await expectEnvelope(response, "not_found");
  });

  it("401 envelope is returned without docs when DOCS_BASE_URL is unset", async () => {
    const response = await handleRequest(new Request("https://api.test/v1/whoami"), { DB: workspaceDb() });
    expect(response.status).toBe(401);
    const body = await expectEnvelope(response, "not_authenticated");
    expect(body.error.docs).toBeUndefined();
  });

  it("409 idempotency_in_flight includes docs URL when DOCS_BASE_URL is set", async () => {
    const env: Env = {
      DOCS_BASE_URL: "https://docs.agent-paste.sh",
      AUTH: authStub(),
      DB: {
        ...workspaceDb(),
        async updateWebSettings() {
          throw new IdempotencyInFlightError("web.settings.update", "k");
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer workos",
          "content-type": "application/json",
          "idempotency-key": "k",
        },
        body: JSON.stringify({ workspace_name: "Demo", auto_deletion_days: 7 }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    const body = await expectEnvelope(response, "idempotency_in_flight");
    expect(body.error.docs).toBe("https://docs.agent-paste.sh/errors/idempotency_in_flight");
  });

  it("400 invalid_request validates payload and emits envelope", async () => {
    const env: Env = {
      AUTH: authStub(),
      DB: workspaceDb(),
    };
    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer workos",
          "content-type": "application/json",
          "idempotency-key": "k",
        },
        body: JSON.stringify({ workspace_name: "", auto_deletion_days: 7 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    await expectEnvelope(response, "invalid_request");
  });

  it("429 rate_limited_actor includes Retry-After and docs URL", async () => {
    const env: Env = {
      DOCS_BASE_URL: "https://docs.agent-paste.sh/",
      AUTH: authStub(),
      DB: workspaceDb(),
      ACTOR_RATE_LIMIT: {
        async limit() {
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer ok" } }),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    const body = await expectEnvelope(response, "rate_limited_actor");
    expect(body.error.docs).toBe("https://docs.agent-paste.sh/errors/rate_limited_actor");
  });

  it("500 envelope echoes a valid inbound X-Request-Id", async () => {
    const env: Env = {
      AUTH: authStub(),
      DB: {
        ...workspaceDb(),
        async getWhoami() {
          throw new Error("boom");
        },
      },
    };

    const requestId = "trace-abcdef0123456789";
    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", {
        headers: { authorization: "Bearer ok", "x-request-id": requestId },
      }),
      env,
    );

    expect(response.status).toBe(500);
    const body = await expectEnvelope(response, "internal_error");
    expect(body.error.request_id).toBe(requestId);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it("ignores malformed inbound X-Request-Id and mints a fresh one", async () => {
    const response = await handleRequest(
      new Request("https://api.test/missing", { headers: { "x-request-id": "bad id with spaces" } }),
      { DB: workspaceDb() },
    );

    expect(response.status).toBe(404);
    const body = await expectEnvelope(response, "not_found");
    expect(body.error.request_id).not.toBe("bad id with spaces");
  });

  it("200 success response also carries X-Request-Id matching the inbound header", async () => {
    const requestId = "success-path-req-id";
    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", {
        headers: { authorization: "Bearer ap_pk_test", "x-request-id": requestId },
      }),
      { DB: workspaceDb(), AUTH: authStub() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });
});
