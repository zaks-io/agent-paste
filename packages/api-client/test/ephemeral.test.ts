import { issuePowChallenge, solvePowChallenge } from "@agent-paste/tokens/pow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPasteError, ApiClient } from "../src/index.js";

const powSecret = "test-ephemeral-pow-secret";
const workspaceId = "00000000-0000-4000-8000-000000000099";
const provisionResponse = {
  api_key_secret: "ap_pk_preview_0123456789ABCDEF_ephemeralpublishsecret",
  claim_token: "ap_ct_preview_claimsecret000000000000000000_abc",
  workspace_id: workspaceId,
  api_key_id: "key_ephemeral",
  claim_token_id: "ct_ephemeral",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApiClient ephemeral provision", () => {
  it("requests a challenge, solves proof-of-work, and provisions without auth", async () => {
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const counter = await solvePowChallenge(challenge);
    const calls: Request[] = [];
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        if (calls.length === 1) {
          return Response.json(
            { error: { code: "pow_required", message: "pow_required", request_id: "req_pow" }, challenge },
            { status: 401 },
          );
        }
        return Response.json(provisionResponse, { status: 201 });
      },
    });

    await expect(client.ephemeral.provision()).resolves.toEqual(provisionResponse);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.example.test/v1/ephemeral/provision");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
    await expect(calls[1]?.json()).resolves.toMatchObject({
      challenge,
      solution: { nonce: challenge.nonce, counter },
    });
    expect(calls[1]?.headers.get("authorization")).toBeNull();
  });

  it("retries with a fresh challenge after pow_invalid", async () => {
    const firstChallenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const secondChallenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    let challengeFetch = 0;
    let provisionAttempt = 0;
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = request.method === "POST" ? await request.clone().json() : null;
        if (!body || !("solution" in body)) {
          challengeFetch += 1;
          const challenge = challengeFetch === 1 ? firstChallenge : secondChallenge;
          return Response.json(
            { error: { code: "pow_required", message: "pow_required", request_id: "req_pow" }, challenge },
            { status: 401 },
          );
        }
        provisionAttempt += 1;
        if (provisionAttempt === 1) {
          return Response.json(
            { error: { code: "pow_invalid", message: "pow_invalid", request_id: "req_bad" } },
            {
              status: 400,
            },
          );
        }
        return Response.json(provisionResponse, { status: 201 });
      },
    });

    await expect(client.ephemeral.provision()).resolves.toEqual(provisionResponse);
    expect(provisionAttempt).toBe(2);
    expect(challengeFetch).toBe(2);
  });

  it("surfaces provision failures without echoing secrets", async () => {
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = request.method === "POST" ? await request.clone().json() : null;
        if (!body || !("solution" in body)) {
          return Response.json(
            { error: { code: "pow_required", message: "pow_required", request_id: "req_pow" }, challenge },
            { status: 401 },
          );
        }
        return Response.json(
          {
            error: {
              code: "ephemeral_provision_rate_limited",
              message: "ephemeral_provision_rate_limited",
              request_id: "req_limit",
            },
          },
          { status: 429 },
        );
      },
    });

    await expect(client.ephemeral.provision({ maxPowAttempts: 1 })).rejects.toMatchObject({
      code: "ephemeral_provision_rate_limited",
      status: 429,
      requestId: "req_limit",
    });
    await expect(client.ephemeral.provision({ maxPowAttempts: 1 })).rejects.not.toSatisfy((error: unknown) => {
      const message = error instanceof AgentPasteError ? error.message : String(error);
      return message.includes(provisionResponse.api_key_secret) || message.includes(provisionResponse.claim_token);
    });
  });
});
