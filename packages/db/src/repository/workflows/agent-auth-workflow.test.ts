import { describe, expect, it } from "vitest";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";

function identity(jti: string) {
  return {
    providerIssuer: "https://provider.example",
    providerSubject: "user_123",
    audience: "https://api.example",
    providerClientId: "client_123",
    email: "person@example.com",
    jti,
    jtiExpiresAt: "2099-06-20T12:05:00.000Z",
    assertionExpiresInSeconds: 3600,
    claimExpiresInSeconds: 600,
    now: new Date("2099-06-20T12:00:00.000Z"),
  };
}

describe("agent auth workflow", () => {
  it("JIT provisions once, resumes by provider delegation, and issues short-lived access tokens", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper", apiKeyEnv: "preview" });

    const first = await repo.registerAgentVerifiedIdentity(identity("jti_1"));
    expect(first.kind).toBe("verified");
    if (first.kind !== "verified") throw new Error("expected_verified");

    const local = repo as LocalRepository;
    expect(local.workspaces.size).toBe(1);
    const member = [...local.workspaceMembers.values()][0];
    expect(member?.workos_user_id).toMatch(/^agent-auth:/);

    const token = await repo.exchangeAgentAuthIdentityAssertion({
      registrationId: first.registration.id,
      accessTokenExpiresInSeconds: 3600,
      now: new Date("2099-06-20T12:01:00.000Z"),
    });
    expect(token.kind).toBe("issued");
    if (token.kind !== "issued") throw new Error("expected_token");
    await expect(repo.verifyApiKey(token.access_token)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: member?.workspace_id,
      scopes: ["publish", "read"],
      expires_at: "2099-06-20T13:01:00.000Z",
    });

    const replay = await repo.registerAgentVerifiedIdentity(identity("jti_1"));
    expect(replay).toEqual({ kind: "replay_detected" });

    const resumed = await repo.registerAgentVerifiedIdentity(identity("jti_2"));
    expect(resumed.kind).toBe("verified");
    expect(local.workspaces.size).toBe(1);
    expect(local.agentAuthDelegations.size).toBe(1);
  });

  it("registers anonymous agents, claims with the browser account, and upgrades to a member workspace token", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper", apiKeyEnv: "preview" });
    const local = repo as LocalRepository;

    const registered = await repo.registerAgentAnonymousIdentity({
      audience: "https://api.example",
      now: new Date("2099-06-20T12:00:00.000Z"),
    });
    expect(registered.kind).toBe("registered");
    expect(registered.registration.registration_type).toBe("anonymous");
    expect(local.workspaces.size).toBe(1);
    const sourceWorkspaceId = local.agentAuthRegistrations.get(registered.registration.id)?.workspace_id;
    if (!sourceWorkspaceId) throw new Error("expected_source_workspace");

    const preClaim = await repo.exchangeAgentAuthIdentityAssertion({
      registrationId: registered.registration.id,
      anonymousClaimState: "pre_claim",
      accessTokenExpiresInSeconds: 3600,
      now: new Date("2099-06-20T12:01:00.000Z"),
    });
    expect(preClaim.kind).toBe("issued");
    if (preClaim.kind !== "issued") throw new Error("expected_preclaim_token");
    await expect(repo.verifyApiKey(preClaim.access_token)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: sourceWorkspaceId,
      scopes: ["publish", "read"],
    });

    const started = await repo.startAgentAuthAnonymousClaim({
      claimToken: registered.claim_token,
      claimAttemptExpiresInSeconds: 600,
      now: new Date("2099-06-20T12:02:00.000Z"),
    });
    expect(started.kind).toBe("initiated");
    if (started.kind !== "initiated") throw new Error("expected_claim_start");
    expect(local.agentAuthRegistrations.get(registered.registration.id)?.email).toBe("");

    const member = await repo.resolveWebMember({
      workosUserId: "user_person",
      email: "person@example.com",
      idempotencyKey: "agent-auth-anon-member",
      now: "2099-06-20T12:03:00.000Z",
    });
    await expect(
      repo.completeAgentAuthAnonymousClaim({
        actor: {
          type: "member",
          id: member.workspace_member.id,
          workspace_id: member.workspace.id,
          email: member.workspace_member.email,
          scopes: member.scopes,
        },
        claimAttemptToken: started.claim_attempt_token,
        userCode: "000000",
        now: new Date("2099-06-20T12:04:00.000Z"),
      }),
    ).resolves.toBeNull();

    const completed = await repo.completeAgentAuthAnonymousClaim({
      actor: {
        type: "member",
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      },
      claimAttemptToken: started.claim_attempt_token,
      userCode: started.user_code,
      now: new Date("2099-06-20T12:05:00.000Z"),
    });
    expect(completed).toMatchObject({
      id: registered.registration.id,
      registration_type: "anonymous",
    });
    expect(local.agentAuthRegistrations.get(registered.registration.id)?.email).toBe("person@example.com");

    await expect(repo.verifyApiKey(preClaim.access_token)).resolves.toBeNull();
    expect(local.workspaces.get(sourceWorkspaceId ?? "")?.claimed_at).toBe("2099-06-20T12:05:00.000Z");

    const staleAssertion = await repo.exchangeAgentAuthIdentityAssertion({
      registrationId: registered.registration.id,
      anonymousClaimState: "pre_claim",
      accessTokenExpiresInSeconds: 3600,
      now: new Date("2099-06-20T12:07:00.000Z"),
    });
    expect(staleAssertion).toEqual({ kind: "invalid_grant" });

    const postClaimAssertion = await repo.exchangeAgentAuthIdentityAssertion({
      registrationId: registered.registration.id,
      anonymousClaimState: "post_claim",
      accessTokenExpiresInSeconds: 3600,
      now: new Date("2099-06-20T12:08:00.000Z"),
    });
    expect(postClaimAssertion.kind).toBe("issued");
    if (postClaimAssertion.kind !== "issued") throw new Error("expected_postclaim_assertion_token");
    await expect(repo.verifyApiKey(postClaimAssertion.access_token)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: member.workspace.id,
      scopes: ["publish", "read"],
    });

    const postClaim = await repo.exchangeAgentAuthClaimToken({
      claimToken: registered.claim_token,
      accessTokenExpiresInSeconds: 3600,
      now: new Date("2099-06-20T12:07:00.000Z"),
    });
    expect(postClaim.kind).toBe("issued");
    if (postClaim.kind !== "issued") throw new Error("expected_postclaim_token");
    await expect(repo.verifyApiKey(postClaim.access_token)).resolves.toMatchObject({
      type: "api_key",
      workspace_id: member.workspace.id,
      scopes: ["publish", "read"],
    });
  });
});
