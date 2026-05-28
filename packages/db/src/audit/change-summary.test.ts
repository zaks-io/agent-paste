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
    expect(formatChangeSummary("custom.action", {})).toBe("");
  });

  it("formats lockdown summaries without reason codes and unknown scopes", () => {
    expect(formatChangeSummary("platform.lockdown.set", { scope: "artifact" })).toBe(
      "Platform lockdown set on artifact",
    );
    expect(formatChangeSummary("platform.lockdown.lifted", { scope: "workspace", reason_code: "abuse" })).toBe(
      "Platform lockdown lifted on workspace (was: abuse)",
    );
    expect(formatChangeSummary("platform.lockdown.set", { scope: "unknown" })).toBe(
      "Platform lockdown set on target",
    );
  });

  it("formats lifecycle action summaries across branches", () => {
    expect(formatChangeSummary("api_key.created", {})).toBe("API key created");
    expect(formatChangeSummary("api_key.revoked", {})).toBe("API key revoked");
    expect(formatChangeSummary("workspace.created", {})).toBe("Workspace created");
    expect(formatChangeSummary("workspace.settings.updated", {})).toBe("Workspace settings updated");
    expect(formatChangeSummary("artifact.created", {})).toBe("Artifact created");
    expect(formatChangeSummary("artifact.deleted", {})).toBe("Artifact deleted");
    expect(formatChangeSummary("artifact.pinned", {})).toBe("Artifact pinned");
    expect(formatChangeSummary("artifact.unpinned", {})).toBe("Artifact unpinned");
    expect(formatChangeSummary("revision.draft_created", {})).toBe("Draft revision created");
    expect(formatChangeSummary("upload_session.created", {})).toBe("Upload session created");
    expect(formatChangeSummary("upload_session.finalized", {})).toBe("Upload session finalized");
    expect(formatChangeSummary("upload_session.expired", {})).toBe("Upload session expired");
    expect(formatChangeSummary("upload_session.failed", {})).toBe("Upload session failed");
  });

  it("formats publish summaries for partial details and singular file counts", () => {
    expect(formatChangeSummary("artifact.published", { revision_number: 4 })).toBe("Published revision 4");
    expect(formatChangeSummary("artifact.published", {})).toBe("Artifact published");
    expect(formatChangeSummary("artifact.published", { revision_number: 1, file_count: 1 })).toBe(
      "Published revision 1 (1 file)",
    );
  });

  it("formats cleanup summaries with defaulted counts", () => {
    expect(formatChangeSummary("cleanup.run", {})).toBe("Cleanup ran");
    expect(formatChangeSummary("cleanup.run", { expired_artifacts: 2 })).toBe("Cleanup ran (2 artifacts, 0 sessions)");
  });

  it("skips non-object detail values when redacting", () => {
    expect(redactAuditDetails({ tags: ["public"], secret: "x" })).toEqual({ tags: ["public"] });
  });
});
