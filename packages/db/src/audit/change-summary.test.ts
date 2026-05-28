import { describe, expect, it } from "vitest";
import {
  classifyAuditAction,
  formatChangeSummary,
  isSecurityRelevantAction,
  redactAuditDetails,
} from "./change-summary.js";

describe("change-summary", () => {
  it("classifies security-relevant actions", () => {
    expect(isSecurityRelevantAction("platform.lockdown.set")).toBe(true);
    expect(isSecurityRelevantAction("artifact.published")).toBe(false);
    expect(classifyAuditAction("api_key.revoked")).toBe("security");
    expect(classifyAuditAction("api_key.created")).toBe("lifecycle");
  });

  it("redacts sensitive detail keys", () => {
    expect(
      redactAuditDetails({
        name: "demo",
        secret: "ap_pk_test_deadbeef",
        nested: { token: "t", file_count: 2 },
      }),
    ).toEqual({ name: "demo", nested: { file_count: 2 } });
  });

  it("formats platform lockdown summaries with reason codes only", () => {
    expect(
      formatChangeSummary("platform.lockdown.set", {
        scope: "workspace",
        reason_code: "phishing_report",
        operator_note: "should not appear",
      }),
    ).toBe("Platform lockdown set on workspace (reason: phishing_report)");
  });

  it("formats publish and settings summaries", () => {
    expect(
      formatChangeSummary("artifact.published", { revision_number: 2, file_count: 3, secret: "x" }),
    ).toBe("Published revision 2 (3 files)");
    expect(formatChangeSummary("workspace.settings.updated", { auto_deletion_days: 14 })).toBe(
      "Workspace settings updated (14-day auto-deletion)",
    );
  });

  it("falls back to sorted key=value pairs for unknown actions", () => {
    expect(formatChangeSummary("custom.action", { b: 2, a: 1 })).toBe("a=1, b=2");
  });
});
