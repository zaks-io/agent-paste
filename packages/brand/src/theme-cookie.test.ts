import { describe, expect, it } from "vitest";
import { buildThemeCookie, readThemeCookie, THEME_COOKIE, themeCookieDomain } from "./theme-cookie.js";

describe("themeCookieDomain", () => {
  it("scopes to the registrable parent so all subdomains share it", () => {
    expect(themeCookieDomain("agent-paste.sh")).toBe(".agent-paste.sh");
    expect(themeCookieDomain("app.agent-paste.sh")).toBe(".agent-paste.sh");
    expect(themeCookieDomain("preview.agent-paste.sh")).toBe(".preview.agent-paste.sh");
    expect(themeCookieDomain("app.preview.agent-paste.sh")).toBe(".preview.agent-paste.sh");
  });

  it("is host-only (null) off the product domain", () => {
    expect(themeCookieDomain("localhost")).toBeNull();
    expect(themeCookieDomain("agent-paste-apex-preview.isaac.workers.dev")).toBeNull();
  });
});

describe("readThemeCookie", () => {
  it("reads a valid preference among other cookies", () => {
    expect(readThemeCookie("a=1; agp_theme=dark; b=2")).toBe("dark");
    expect(readThemeCookie("agp_theme=light")).toBe("light");
    expect(readThemeCookie("agp_theme=system")).toBe("system");
  });

  it("returns null when absent or invalid", () => {
    expect(readThemeCookie("")).toBeNull();
    expect(readThemeCookie("other=x")).toBeNull();
    expect(readThemeCookie("agp_theme=neon")).toBeNull();
  });
});

describe("buildThemeCookie", () => {
  it("sets the shared name, parent domain, root path, and a long max-age", () => {
    const c = buildThemeCookie("dark", "app.agent-paste.sh", true);
    expect(c).toContain(`${THEME_COOKIE}=dark`);
    expect(c).toContain("Domain=.agent-paste.sh");
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).toContain("Max-Age=31536000");
  });

  it("omits Domain and Secure for a non-product, non-https host", () => {
    const c = buildThemeCookie("light", "localhost", false);
    expect(c).not.toContain("Domain=");
    expect(c).not.toContain("Secure");
  });

  it("round-trips through readThemeCookie", () => {
    const c = buildThemeCookie("system", "agent-paste.sh", true);
    // The name=value pair is the first segment; reading it back yields the value.
    expect(readThemeCookie(c.split(";")[0])).toBe("system");
  });
});
