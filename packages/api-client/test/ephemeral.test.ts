import { ClaimCode } from "@agent-paste/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPasteError, ApiClient } from "../src/index.js";

const workspaceId = "00000000-0000-4000-8000-000000000099";
const claimCode = ClaimCode.parse("clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD");
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
  it("provisions without auth or a challenge", async () => {
    const calls: Request[] = [];
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(provisionResponse, { status: 201 });
      },
    });

    await expect(client.ephemeral.provision()).resolves.toEqual(provisionResponse);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.example.test/v1/ephemeral/provision");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
    await expect(calls[0]?.json()).resolves.toEqual({});
  });

  it("sends claim code on the provision request", async () => {
    const calls: Request[] = [];
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(provisionResponse, { status: 201 });
      },
    });

    await expect(client.ephemeral.provision({ claimCode })).resolves.toEqual(provisionResponse);

    await expect(calls[0]?.json()).resolves.toEqual({ claim_code: claimCode });
  });

  it("surfaces provision failures without echoing secrets", async () => {
    const client = new ApiClient({
      apiBaseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "ephemeral_provision_rate_limited",
              message: "ephemeral_provision_rate_limited",
              request_id: "req_limit",
            },
          },
          { status: 429 },
        ),
    });

    await expect(client.ephemeral.provision()).rejects.toMatchObject({
      code: "ephemeral_provision_rate_limited",
      status: 429,
      requestId: "req_limit",
    });
    await expect(client.ephemeral.provision()).rejects.not.toSatisfy((error: unknown) => {
      const message = error instanceof AgentPasteError ? error.message : String(error);
      return message.includes(provisionResponse.api_key_secret) || message.includes(provisionResponse.claim_token);
    });
  });
});
