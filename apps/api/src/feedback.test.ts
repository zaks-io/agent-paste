import { createLocalServices } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import { handleMcpApiRequest, handleRequest } from "./index.js";

async function fixture() {
  const services = createLocalServices({ apiKeyPepper: "feedback-test-pepper" });
  const workosUserId = crypto.randomUUID();
  const member = await services.repo.ensureWebMember({
    workosUserId,
    email: "member@example.test",
  });
  const key = await services.repo.createApiKey({
    actor: { type: "admin", id: "operator" },
    idempotencyKey: "create-key",
    workspaceId: member.workspace_id,
    name: "feedback test",
  });
  const row = services.repo.apiKeys.get(key.api_key.id);
  if (!row) throw new Error("key missing");
  row.scopes = ["read"];
  const actorLimiter = vi.fn(async () => ({ success: true }));
  const env = {
    DB: services.repo,
    AUTH: {
      ...services.auth,
      verifyWebToken: vi.fn(async (token: string) =>
        token === "member-token" ? { workos_user_id: workosUserId, email: "member@example.test" } : null,
      ),
    },
    ACTOR_RATE_LIMIT: { limit: actorLimiter },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
  };
  const request = (
    body: unknown = { body: "Feedback" },
    token: string | undefined = key.secret,
    idempotencyKey = "feedback-test-key",
  ) =>
    new Request("https://api.test/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { services, env, key, row, request, actorLimiter, member };
}

describe("feedback HTTP flow", () => {
  it("accepts read-only keys and replays before consuming the rate budget", async () => {
    const f = await fixture();
    const response = await handleRequest(
      f.request({ body: "  trouble publishing  ", context: { surface: "cli" } }),
      f.env,
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(f.services.repo.feedback.get(created.feedback_id)).toMatchObject({
      body: "trouble publishing",
      submitter_kind: "agent",
      submitter_api_key_id: f.row.id,
      contact_email: "member@example.test",
    });
    const replay = await handleRequest(f.request({ body: "changed" }), f.env);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(created);
    expect(f.services.repo.feedback.size).toBe(1);
    expect(f.actorLimiter).toHaveBeenCalledTimes(1);
  });
  it("rejects signed-out, revoked and workspace-locked credentials before capture", async () => {
    const f = await fixture();
    const signedOut = new Request("https://api.test/v1/feedback", { method: "POST" });
    expect((await handleRequest(signedOut, f.env)).status).toBe(401);
    f.row.revoked_at = new Date().toISOString();
    expect((await handleRequest(f.request(), f.env)).status).toBe(401);
    f.row.revoked_at = null;
    await f.services.repo.setLockdown({
      actor: { type: "platform", id: "operator" },
      idempotencyKey: "lock-workspace",
      scope: "workspace",
      targetId: f.row.workspace_id,
      reasonCode: "abuse",
    });
    expect((await handleRequest(f.request(), f.env)).status).toBe(401);
    expect(f.services.repo.feedback.size).toBe(0);
    expect(f.env.AUTH.verifyWebToken).not.toHaveBeenCalled();
  });
  it.each([
    { body: "x".repeat(10001) },
    { body: "before\u0000after" },
    { body: "okay", context: { "key\u0000suffix": "value" } },
    { body: "okay", context: { key: "value\u0000suffix" } },
    { body: "okay", context: { nested: { value: true } } },
    { body: "okay", context: { long: "x".repeat(501) } },
    { body: "okay", context: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, index])) },
  ])("rejects invalid and oversized input without persisting rows", async (body) => {
    const f = await fixture();
    const response = await handleRequest(f.request(body), f.env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(f.services.repo.feedback.size).toBe(0);
  });
  it("accepts authenticated dashboard members", async () => {
    const f = await fixture();
    const response = await handleRequest(f.request({ body: "dashboard report" }, "member-token"), f.env);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(f.services.repo.feedback.get(result.feedback_id)).toMatchObject({
      submitter_kind: "member",
      submitter_member_id: f.member.id,
      contact_email: "member@example.test",
    });
  });
  it.each(["dashboard", "mcp"])("accepts %s member feedback from a locked Workspace", async (surface) => {
    const f = await fixture();
    const member = f.services.repo.workspaceMembers.get(f.member.id);
    if (!member) throw new Error("member missing");
    member.scopes = ["read"];
    await f.services.repo.setLockdown({
      actor: { type: "platform", id: "operator" },
      idempotencyKey: "lock-workspace",
      scope: "workspace",
      targetId: member.workspace_id,
      reasonCode: "abuse",
    });
    const response =
      surface === "dashboard"
        ? await handleRequest(f.request({ body: "lockdown appeal" }, "member-token"), f.env)
        : await handleMcpApiRequest(
            f.request({ body: "lockdown appeal" }, ""),
            f.env,
            member.workos_user_id,
            "feedback.create",
          );
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(f.services.repo.feedback.get(result.feedback_id)).toMatchObject({
      workspace_id: member.workspace_id,
      submitter_kind: "member",
      submitter_member_id: member.id,
      submitter_api_key_id: null,
    });
  });
  it("keeps member sessions outside existing CLI-or-MCP routes", async () => {
    const f = await fixture();
    const response = await handleRequest(
      new Request("https://api.test/v1/artifacts", { headers: { Authorization: "Bearer member-token" } }),
      f.env,
    );
    expect(response.status).toBe(401);
    expect(f.env.AUTH.verifyWebToken).not.toHaveBeenCalled();
  });
  it("requires an idempotency key and fails closed when actor budget is exhausted", async () => {
    const f = await fixture();
    const missing = f.request();
    missing.headers.delete("Idempotency-Key");
    expect((await handleRequest(missing, f.env)).status).toBe(400);
    f.actorLimiter.mockResolvedValue({ success: false });
    expect((await handleRequest(f.request(), f.env)).status).toBe(429);
    expect(f.services.repo.feedback.size).toBe(0);
  });
  it("accepts authenticated MCP members without publish scope", async () => {
    const f = await fixture();
    const memberRow = f.services.repo.workspaceMembers.get(f.member.id);
    if (!memberRow) throw new Error("member missing");
    memberRow.scopes = ["read"];
    const response = await handleMcpApiRequest(
      f.request({ body: "MCP feedback" }, ""),
      f.env,
      memberRow.workos_user_id,
      "feedback.create",
    );
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(f.services.repo.feedback.get(result.feedback_id)).toMatchObject({
      submitter_kind: "member",
      submitter_member_id: memberRow.id,
      submitter_api_key_id: null,
    });
  });
});
