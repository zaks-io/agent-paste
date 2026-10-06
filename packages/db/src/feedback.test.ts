import { WebOperatorEventRow } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { resolveFeedbackContact } from "./feedback-contact.js";
import { LocalRepository } from "./local-repository.js";
import { localEntities } from "./repository/local-entities.js";
import { CrossTenantWriteError, scopedLocalState } from "./repository/local-scope.js";
import { createLocalState } from "./repository/local-state.js";
import { toWebOperatorEventRow } from "./repository/web-transforms.js";
import type { ApiActor, Feedback } from "./types.js";

const agent: ApiActor = { type: "api_key", id: "key_actor", workspace_id: "home", scopes: ["read"] };
const member: ApiActor = {
  type: "member",
  id: "mem_actor",
  workspace_id: "home",
  email: "member@example.test",
  scopes: [],
};

describe("feedback persistence", () => {
  it("resolves contact without I/O or inventing an email", () => {
    expect(resolveFeedbackContact(member, "owner@example.test")).toBe("member@example.test");
    expect(resolveFeedbackContact(agent, "owner@example.test")).toBe("owner@example.test");
    expect(resolveFeedbackContact(agent, null)).toBeNull();
  });
  it("captures actor identity, contact snapshot and metadata once per idempotency key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "test-pepper" });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "operator" },
      idempotencyKey: "workspace",
      email: "owner@example.test",
    });
    const actor = { ...agent, workspace_id: workspace.id };
    const first = await repo.submitFeedback({
      actor,
      idempotencyKey: "feedback-key",
      request: { body: "first", context: { surface: "cli" } },
    });
    workspace.contact_email = "changed@example.test";
    const replay = await repo.submitFeedback({ actor, idempotencyKey: "feedback-key", request: { body: "duplicate" } });
    expect(replay).toEqual(first);
    expect(repo.feedback.size).toBe(1);
    expect(repo.feedback.get(first.feedback_id)).toMatchObject({
      workspace_id: workspace.id,
      submitter_kind: "agent",
      submitter_member_id: null,
      submitter_api_key_id: agent.id,
      contact_email: "owner@example.test",
      body: "first",
      context: { surface: "cli" },
      status: "new",
      notification_suppressed: false,
    });
    const events = [...repo.operationEvents.values()].filter((event) => event.action === "feedback.created");
    expect(events).toHaveLength(1);
    expect(events[0]?.details).toEqual({});
    const event = events[0];
    if (!event) throw new Error("missing audit event");
    expect(WebOperatorEventRow.safeParse(toWebOperatorEventRow(event)).success).toBe(true);
    const fromMember = await repo.submitFeedback({
      actor: { ...member, workspace_id: workspace.id },
      idempotencyKey: "member-feedback",
      request: { body: "member report" },
    });
    expect(repo.feedback.get(fromMember.feedback_id)).toMatchObject({
      submitter_kind: "member",
      submitter_member_id: member.id,
      submitter_api_key_id: null,
      contact_email: member.email,
    });
  });
  it("filters foreign reads and throws on foreign writes through the RLS-faithful local adapter", async () => {
    const state = createLocalState();
    const row: Feedback = {
      id: "fb_one",
      workspace_id: "home",
      submitter_kind: "agent",
      submitter_member_id: null,
      submitter_api_key_id: "key_one",
      contact_email: null,
      body: "report",
      context: null,
      status: "new",
      notification_suppressed: false,
      created_at: "2026-10-06T00:00:00.000Z",
      updated_at: "2026-10-06T00:00:00.000Z",
    };
    await localEntities(scopedLocalState(state, { kind: "workspace", workspaceId: "home" })).feedback.insert(row);
    const foreign = localEntities(scopedLocalState(state, { kind: "workspace", workspaceId: "other" }));
    expect(await foreign.feedback.findById(row.id)).toBeNull();
    await expect(foreign.feedback.insert(row)).rejects.toThrow(CrossTenantWriteError);
  });
});
