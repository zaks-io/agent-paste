import { describe, expect, it } from "vitest";
import {
  lockdownTriageFromEvent,
  lockdownTriageQueryString,
  parseLockdownTriageSearch,
} from "../src/lib/lockdown-triage";

describe("lockdown-triage", () => {
  it("parses triage search params", () => {
    expect(
      parseLockdownTriageSearch({
        triage_scope: "artifact",
        triage_target: " art_1 ",
        triage_reason: "phishing_report",
      }),
    ).toEqual({
      scope: "artifact",
      target_id: "art_1",
      reason_code: "phishing_report",
    });
  });

  it("builds triage query strings for the admin route", () => {
    expect(
      lockdownTriageQueryString({
        scope: "workspace",
        target_id: "ws_1",
        reason_code: "abuse_complaint",
      }),
    ).toEqual({
      triage_scope: "workspace",
      triage_target: "ws_1",
      triage_reason: "abuse_complaint",
    });
  });

  it("ignores invalid triage search and event shapes", () => {
    expect(parseLockdownTriageSearch({ triage_scope: "invalid" })).toEqual({});
    expect(
      lockdownTriageFromEvent({
        target_type: "api_key",
        target: "api_key:key_1",
        change_summary: "",
      }),
    ).toBeNull();
    expect(
      lockdownTriageFromEvent({
        target_type: "workspace",
        target: "workspace:",
        change_summary: "Platform lockdown set on workspace",
      }),
    ).toBeNull();
    expect(
      lockdownTriageFromEvent({
        target_type: "artifact",
        target: "artifact:art_1",
        change_summary: "Artifact published",
      }),
    ).toEqual({ scope: "artifact", target_id: "art_1" });
  });

  it("derives lockdown prefill from operator event rows", () => {
    expect(
      lockdownTriageFromEvent({
        target_type: "workspace",
        target: "workspace:ws_abc",
        change_summary: "Platform lockdown set on workspace (reason: abuse)",
      }),
    ).toEqual({
      scope: "workspace",
      target_id: "ws_abc",
      reason_code: "abuse",
    });
  });
});
