import { describe, expect, it } from "vitest";
import {
  buildOptionalAnalyticsCookie,
  GPC_SUPPORT_BODY,
  GPC_SUPPORT_PATH,
  OPTIONAL_ANALYTICS_COOKIE,
  optionalAnalyticsCookieDomain,
  readOptionalAnalyticsCookie,
  shouldDisableOptionalAnalytics,
} from "./privacy-preferences.js";

describe("optional analytics preference", () => {
  it("publishes the GPC support resource payload", () => {
    expect(GPC_SUPPORT_PATH).toBe("/.well-known/gpc.json");
    expect(JSON.parse(GPC_SUPPORT_BODY)).toEqual({ gpc: true, lastUpdate: "2026-06-14" });
  });

  it("reads an optional analytics preference among other cookies", () => {
    expect(readOptionalAnalyticsCookie("a=1; agp_analytics=off; b=2")).toBe("off");
    expect(readOptionalAnalyticsCookie("agp_analytics=on")).toBe("on");
    expect(readOptionalAnalyticsCookie("agp_analytics=maybe")).toBeNull();
    expect(readOptionalAnalyticsCookie("a=1")).toBeNull();
  });

  it("uses the shared parent-domain cookie boundary", () => {
    expect(optionalAnalyticsCookieDomain("agent-paste.sh")).toBe(".agent-paste.sh");
    expect(optionalAnalyticsCookieDomain("app.agent-paste.sh")).toBe(".agent-paste.sh");
    expect(optionalAnalyticsCookieDomain("app.preview.agent-paste.sh")).toBe(".preview.agent-paste.sh");
    expect(optionalAnalyticsCookieDomain("localhost")).toBeNull();
  });

  it("builds a first-party preference cookie", () => {
    expect(buildOptionalAnalyticsCookie("off", "app.agent-paste.sh", true)).toBe(
      `${OPTIONAL_ANALYTICS_COOKIE}=off; Path=/; Max-Age=31536000; SameSite=Lax; Domain=.agent-paste.sh; Secure`,
    );
    expect(buildOptionalAnalyticsCookie("on", "localhost", false)).toBe(
      `${OPTIONAL_ANALYTICS_COOKIE}=on; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });

  it("disables optional analytics for browser privacy signals or an opt-out cookie", () => {
    expect(shouldDisableOptionalAnalytics({ secGpc: "1" })).toBe(true);
    expect(shouldDisableOptionalAnalytics({ secGpc: "0, 1" })).toBe(true);
    expect(shouldDisableOptionalAnalytics({ dnt: "1" })).toBe(true);
    expect(shouldDisableOptionalAnalytics({ cookieString: "agp_analytics=off" })).toBe(true);
  });

  it("does not disable optional analytics for malformed signals or an opt-in cookie", () => {
    expect(shouldDisableOptionalAnalytics({ secGpc: "10" })).toBe(false);
    expect(shouldDisableOptionalAnalytics({ dnt: "0" })).toBe(false);
    expect(shouldDisableOptionalAnalytics({ cookieString: "agp_analytics=on" })).toBe(false);
  });

  it("lets browser privacy signals override a site-level opt-in", () => {
    expect(shouldDisableOptionalAnalytics({ secGpc: "1", cookieString: "agp_analytics=on" })).toBe(true);
    expect(shouldDisableOptionalAnalytics({ dnt: "1", cookieString: "agp_analytics=on" })).toBe(true);
  });
});
