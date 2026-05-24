import { describe, expect, it } from "vitest";
import {
  isValidAgentViewTokenPayload,
  mintAgentViewToken,
  mintAgentViewUrl,
  verifyAgentViewToken,
} from "./agent-view.js";
import type { Clock } from "./clock.js";

const fixedClock = (seconds: number): Clock => ({ now: () => seconds * 1000 });
const SECRET = "agent-view-secret";
const base = { artifact_id: "art_1", revision_id: "rev_1", exp: 2000 };

describe("isValidAgentViewTokenPayload", () => {
  it("accepts a minimal payload", () => {
    expect(isValidAgentViewTokenPayload(base)).toBe(true);
  });

  it.each([
    { label: "bad artifact_id prefix", value: { ...base, artifact_id: "nope" } },
    { label: "bad revision_id prefix", value: { ...base, revision_id: "nope" } },
    { label: "missing exp", value: { artifact_id: "art_1", revision_id: "rev_1" } },
    { label: "non-integer exp", value: { ...base, exp: 1.5 } },
    { label: "null", value: null },
    { label: "array", value: [] },
  ])("rejects $label", ({ value }) => {
    expect(isValidAgentViewTokenPayload(value)).toBe(false);
  });
});

describe("mint + verify", () => {
  it("round-trips a payload", async () => {
    const token = await mintAgentViewToken(base, SECRET);
    expect(await verifyAgentViewToken(token, SECRET, fixedClock(1000))).toEqual(base);
  });

  it("rejects an expired token", async () => {
    const token = await mintAgentViewToken({ ...base, exp: 1000 }, SECRET);
    expect(await verifyAgentViewToken(token, SECRET, fixedClock(1001))).toBeNull();
  });
});

describe("mintAgentViewUrl", () => {
  it("builds {baseUrl}/v1/public/agent-view/{token}", async () => {
    const url = await mintAgentViewUrl({ baseUrl: "https://api.example", secret: SECRET, payload: base });
    expect(url).toMatch(/^https:\/\/api\.example\/v1\/public\/agent-view\/[^/]+$/);
  });
});
