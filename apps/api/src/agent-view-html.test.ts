import { describe, expect, it } from "vitest";
import { htmlAgentViewResponse } from "./agent-view-html.js";
import type { AppContext } from "./env.js";

function contextWithRequestId(requestId: string): AppContext {
  return { get: () => requestId } as unknown as AppContext;
}

describe("htmlAgentViewResponse security headers", () => {
  it("adds the baseline without losing its tailored CSP or referrer policy", () => {
    const response = htmlAgentViewResponse(contextWithRequestId("req-1"), {
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Agent View",
      files: [],
    });

    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    // Tailored values still win over the baseline.
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
