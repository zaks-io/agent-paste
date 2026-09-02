import { describe, expect, it } from "vitest";
import { AUTH_MD_CONTENT_TYPE, AUTH_MD_PATH, renderAuthMd } from "./index.js";

describe("auth.md skill document", () => {
  const doc = renderAuthMd({ issuer: "https://api.test" });

  it("opens with an H1 carrying the literal auth.md", () => {
    expect(doc.split("\n")[0]).toMatch(/^# .*auth\.md/);
  });

  it("is served from the service root as markdown", () => {
    expect(AUTH_MD_PATH).toBe("/auth.md");
    expect(AUTH_MD_CONTENT_TYPE).toBe("text/markdown; charset=utf-8");
  });

  it("points at both discovery documents on the issuer origin", () => {
    expect(doc).toContain("https://api.test/.well-known/oauth-protected-resource");
    expect(doc).toContain("https://api.test/.well-known/oauth-authorization-server");
    expect(doc).toContain("https://api.test/agent/identity");
  });

  it("names both token grant types", () => {
    expect(doc).toContain("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(doc).toContain("urn:workos:agent-auth:grant-type:claim");
  });

  it("renders identically for every origin that serves the same issuer", () => {
    expect(renderAuthMd({ issuer: "https://api.test" })).toBe(doc);
  });

  it("does not use the retired v0.1.0 discovery vocabulary", () => {
    for (const retired of ["register_uri", "claim_uri", "revocation_uri", "verified_email"]) {
      expect(doc).not.toContain(retired);
    }
  });
});
