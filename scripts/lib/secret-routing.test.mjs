import { describe, expect, it } from "vitest";
import {
  forbiddenSecretsForApp,
  requiredSecretsForApp,
  SECRET_ROUTING,
  secretConsumingApps,
  secretsForApp,
} from "./secret-routing.mjs";

describe("secret-routing", () => {
  it("lists only apps that consume secrets", () => {
    expect(secretConsumingApps()).toEqual(Object.keys(SECRET_ROUTING));
    expect(secretConsumingApps()).not.toContain("apex");
  });

  it("scopes preview-only secrets out of production", () => {
    expect(secretsForApp("api", "preview")).toContain("SMOKE_HARNESS_SECRET");
    expect(secretsForApp("api", "production")).not.toContain("SMOKE_HARNESS_SECRET");
    expect(secretsForApp("jobs", "preview")).toContain("SMOKE_HARNESS_SECRET");
    expect(secretsForApp("jobs", "production")).not.toContain("SMOKE_HARNESS_SECRET");
  });

  it("forbids stale smoke harness bindings on production api and jobs", () => {
    expect(forbiddenSecretsForApp("api", "production")).toEqual(["SMOKE_HARNESS_SECRET"]);
    expect(forbiddenSecretsForApp("jobs", "production")).toEqual(["SMOKE_HARNESS_SECRET"]);
    expect(forbiddenSecretsForApp("api", "preview")).toEqual([]);
    expect(forbiddenSecretsForApp("jobs", "preview")).toEqual([]);
  });

  it("scopes production-only secrets out of preview", () => {
    expect(secretsForApp("api", "production")).toContain("CF_ACCESS_AUD");
    expect(secretsForApp("api", "preview")).not.toContain("CF_ACCESS_AUD");
  });

  it("excludes rotation-overlap and optional secrets from required set", () => {
    const required = requiredSecretsForApp("api", "production");
    expect(required).not.toContain("API_KEY_PEPPER_V2");
    expect(required).not.toContain("ARTIFACT_BYTES_ENCRYPTION_KEY_V2");
    expect(required).not.toContain("CF_ACCESS_AUD");
    expect(required).toContain("API_KEY_PEPPER_V1");
    expect(secretsForApp("api", "production")).toContain("ARTIFACT_BYTES_ENCRYPTION_KEY_V2");
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
      "ARTIFACT_BYTES_ENCRYPTION_KEY",
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

  it("routes MCP Sentry DSN as optional provider config", () => {
    for (const env of ["preview", "production"]) {
      expect(secretsForApp("mcp", env, { source: "sentry" })).toEqual(["SENTRY_DSN"]);
      expect(secretsForApp("mcp", env, { source: "symmetric" })).not.toContain("SENTRY_DSN");
      expect(requiredSecretsForApp("mcp", env)).not.toContain("SENTRY_DSN");
    }
  });

  it("routes the URL scanner creds as optional, cloudflare-sourced, on jobs both envs (AP-376)", () => {
    const scannerNames = ["URL_SCANNER_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
    for (const env of ["preview", "production"]) {
      const cloudflareForEnv = secretsForApp("jobs", env, { source: "cloudflare" });
      expect(cloudflareForEnv).toEqual(expect.arrayContaining(scannerNames));
      // Advisory abuse control: never hard-required, so a deploy without the creds
      // still succeeds and the scanner fail-opens to verdict "unknown".
      for (const name of scannerNames) {
        expect(requiredSecretsForApp("jobs", env)).not.toContain(name);
        expect(secretsForApp("jobs", env)).toContain(name);
      }
    }
  });

  it("routes the four Stripe billing secrets as optional, stripe-sourced, on api both envs", () => {
    const stripeNames = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SIGNING_SECRET",
      "STRIPE_PRICE_ID_MONTHLY",
      "STRIPE_PRICE_ID_ANNUAL",
    ];
    for (const env of ["preview", "production"]) {
      const stripeForEnv = secretsForApp("api", env, { source: "stripe" });
      expect(stripeForEnv).toEqual(expect.arrayContaining(stripeNames));
      // Off-by-default: never hard-required, so a no-Stripe deploy still succeeds.
      for (const name of stripeNames) {
        expect(requiredSecretsForApp("api", env)).not.toContain(name);
      }
    }
  });
});
