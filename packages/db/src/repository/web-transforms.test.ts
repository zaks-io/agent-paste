import { describe, expect, it } from "vitest";
import type { Artifact, OperationEvent } from "../types.js";
import { toWebArtifactRow, toWebAuditRow, toWebOperatorEventRow, webArtifactStatus } from "./web-transforms.js";

const base: Artifact = {
  id: "art_1",
  workspace_id: "ws_1",
  revision_id: "rev_1",
  status: "active",
  title: "Demo",
  entrypoint: "index.html",
  file_count: 1,
  size_bytes: 1,
  expires_at: "2026-02-01T00:00:00.000Z",
  pinned_at: null,
  created_by_type: "api_key",
  created_by_id: "key_1",
  access_link_lockdown_at: null,
  deleted_at: null,
  delete_reason: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("web artifact transforms", () => {
  it("maps lifecycle and pinning fields for dashboard rows", () => {
    expect(webArtifactStatus({ ...base, status: "deleted" })).toBe("Deleted");
    expect(webArtifactStatus({ ...base, status: "expired" })).toBe("Expired");
    expect(webArtifactStatus(base)).toBe("Published");

    expect(toWebArtifactRow({ ...base, pinned_at: "2026-01-02T00:00:00.000Z" })).toMatchObject({
      pinned: true,
      lockdown: false,
      auto_delete_at: null,
    });
    expect(toWebArtifactRow({ ...base, access_link_lockdown_at: "2026-01-02T00:00:00.000Z" })).toMatchObject({
      pinned: false,
      lockdown: true,
      auto_delete_at: base.expires_at,
    });
    expect(toWebArtifactRow({ ...base, status: "deleted" })).toMatchObject({
      status: "Deleted",
      auto_delete_at: null,
    });
  });
});

describe("web audit transforms", () => {
  const event: OperationEvent = {
    id: "evt_1",
    workspace_id: "ws_1",
    actor_type: "platform",
    actor_id: "operator@example.com",
    action: "platform.lockdown.set",
    target_type: "workspace",
    target_id: "ws_1",
    details: { scope: "workspace", reason_code: "phishing_report" },
    request_id: "req_1",
    occurred_at: "2026-01-01T00:00:00.000Z",
  };

  it("maps operation events to tenant-safe audit rows", () => {
    expect(toWebAuditRow(event)).toMatchObject({
      action: "platform.lockdown.set",
      target: "workspace:ws_1",
      change_summary: "Platform lockdown set on workspace (reason: phishing_report)",
      request_id: "req_1",
    });
  });

  it("redacts internal actor identity from tenant rows", () => {
    // platform actor: never leak the operator's identity to the tenant.
    expect(toWebAuditRow(event).actor).toBe("Agent Paste staff");
    // system actor: never leak the payment processor / internal routing name.
    const billingEvent: OperationEvent = {
      ...event,
      actor_type: "system",
      actor_id: "stripe_webhook",
      action: "workspace.plan.updated",
      details: { previous_plan: "free", plan: "pro", subscription_status: "active", source: "stripe_webhook" },
    };
    const row = toWebAuditRow(billingEvent);
    expect(row.actor).toBe("System");
    // change summary must not echo details.source (stripe_webhook).
    expect(row.change_summary).toBe("Plan changed to Pro");
    expect(JSON.stringify(row)).not.toContain("stripe_webhook");
  });

  it("keeps the workspace's own actors identifiable", () => {
    expect(toWebAuditRow({ ...event, actor_type: "member", actor_id: "mem_1" }).actor).toBe("member:mem_1");
    expect(toWebAuditRow({ ...event, actor_type: "api_key", actor_id: "key_1" }).actor).toBe("api_key:key_1");
  });

  it("preserves raw actor identity for the operator surface", () => {
    expect(toWebOperatorEventRow(event)).toMatchObject({
      actor: "platform:operator@example.com",
      actor_type: "platform",
      workspace_id: "ws_1",
      target_type: "workspace",
    });
  });
});
