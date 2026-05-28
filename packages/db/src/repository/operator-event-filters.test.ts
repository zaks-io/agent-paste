import { describe, expect, it } from "vitest";
import {
  OPERATOR_LIFECYCLE_EVENT_ACTIONS,
  OPERATOR_SECURITY_EVENT_ACTIONS,
  resolveOperatorEventActions,
} from "./operator-event-filters.js";

describe("resolveOperatorEventActions", () => {
  it("returns undefined for all focus", () => {
    expect(resolveOperatorEventActions({ focus: "all" })).toBeUndefined();
    expect(resolveOperatorEventActions({})).toBeUndefined();
  });

  it("returns security and lifecycle action lists for focus filters", () => {
    expect(resolveOperatorEventActions({ focus: "security" })).toEqual([...OPERATOR_SECURITY_EVENT_ACTIONS]);
    expect(resolveOperatorEventActions({ focus: "lifecycle" })).toEqual([...OPERATOR_LIFECYCLE_EVENT_ACTIONS]);
  });

  it("prefers an explicit action filter over focus", () => {
    expect(resolveOperatorEventActions({ focus: "security", action: "artifact.published" })).toEqual([
      "artifact.published",
    ]);
  });
});
