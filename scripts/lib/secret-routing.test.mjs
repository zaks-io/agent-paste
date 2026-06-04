import { describe, expect, it } from "vitest";
import { requiredSecretsForApp, SECRET_ROUTING, secretConsumingApps, secretsForApp } from "./secret-routing.mjs";

describe("secret-routing", () => {
  it("lists only apps that consume secrets", () => {
    expect(secretConsumingApps()).toEqual(Object.keys(SECRET_ROUTING));
    expect(secretConsumingApps()).not.toContain("apex");
  });

  it("scopes preview-only secrets out of production", () => {
    expect(secretsForApp("api", "preview")).toContain("SMOKE_HARNESS_SECRET");
    expect(secretsForApp("api", "production")).not.toContain("SMOKE_HARNESS_SECRET");
  });

  it("scopes production-only secrets out of preview", () => {
    expect(secretsForApp("api", "production")).toContain("CF_ACCESS_AUD");
    expect(secretsForApp("api", "preview")).not.toContain("CF_ACCESS_AUD");
  });

  it("excludes rotation-overlap and optional secrets from required set", () => {
    const required = requiredSecretsForApp("api", "production");
    expect(required).not.toContain("API_KEY_PEPPER_V2");
    expect(required).not.toContain("CF_ACCESS_AUD");
    expect(required).toContain("API_KEY_PEPPER_V1");
  });

  it("requires WORKOS_API_KEY on every worker that verifies an MCP bearer", () => {
    for (const app of ["api", "mcp", "upload"]) {
      expect(requiredSecretsForApp(app, "preview")).toContain("WORKOS_API_KEY");
      expect(requiredSecretsForApp(app, "production")).toContain("WORKOS_API_KEY");
    }
  });

  it("required sets match the wrangler.jsonc secrets.required declarations", () => {
    expect(requiredSecretsForApp("api", "preview")).toEqual([
      "ACCESS_LINK_SIGNING_KEY_V1",
      "API_KEY_PEPPER_V1",
      "CONTENT_SIGNING_SECRET",
      "EPHEMERAL_POW_SECRET",
      "STREAM_INTERNAL_SECRET",
      "WORKOS_API_KEY",
    ]);
    expect(requiredSecretsForApp("mcp", "preview")).toEqual(["WORKOS_API_KEY"]);
    expect(requiredSecretsForApp("web", "production")).toEqual(["WORKOS_API_KEY", "WORKOS_COOKIE_PASSWORD"]);
    expect(requiredSecretsForApp("content", "preview")).toEqual([
      "ARTIFACT_BYTES_ENCRYPTION_KEY",
      "CONTENT_SIGNING_SECRET",
    ]);
    expect(requiredSecretsForApp("upload", "production")).toEqual([
      "API_KEY_PEPPER_V1",
      "ARTIFACT_BYTES_ENCRYPTION_KEY",
      "CONTENT_SIGNING_SECRET",
      "UPLOAD_SIGNING_SECRET",
      "WORKOS_API_KEY",
    ]);
    expect(requiredSecretsForApp("stream", "production")).toEqual(["STREAM_INTERNAL_SECRET"]);
  });

  it("filters by source so symmetric and provider-issued secrets are separable", () => {
    expect(secretsForApp("api", "production", { source: "workos" })).toContain("WORKOS_API_KEY");
    expect(secretsForApp("api", "production", { source: "symmetric" })).not.toContain("WORKOS_API_KEY");
    expect(secretsForApp("api", "production", { source: "symmetric" })).toContain("CONTENT_SIGNING_SECRET");
  });
});
