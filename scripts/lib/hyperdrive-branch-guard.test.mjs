import { describe, expect, it, vi } from "vitest";
import {
  assertMigrationBranchMatchesHyperdrive,
  endpointIdFromConnectionUri,
  evaluateBranchDivergence,
  hyperdriveIdFromWranglerConfig,
  hyperdriveOriginEndpointId,
  neonEndpointId,
} from "./hyperdrive-branch-guard.mjs";

const WRANGLER_CONFIG = `{
  // top-level placeholder, never deployed
  "name": "agent-paste-api",
  "hyperdrive": [{ "binding": "DB", "id": "00000000000000000000000000000000" }],
  "env": {
    "preview": {
      "name": "agent-paste-api-preview",
      /* preview reads the preview branch */
      "hyperdrive": [{ "binding": "DB", "id": "7da9ea500b534f3fa522460c8a9f2efc" }]
    },
    "production": {
      "hyperdrive": [{ "binding": "DB", "id": "ca07f5b895084f60b666586c362982fc" }]
    }
  }
}`;

const HYPERDRIVE_GET_OUTPUT = `⛅️ wrangler 4.93.1
─────────────────────
{
  "id": "7da9ea500b534f3fa522460c8a9f2efc",
  "name": "agent-paste-db-preview-branch",
  "origin": {
    "host": "ep-mute-mountain-ap2ca575-pooler.c-7.us-east-1.aws.neon.tech",
    "port": 5432,
    "database": "neondb",
    "scheme": "postgresql",
    "user": "neondb_owner"
  }
}`;

describe("neonEndpointId", () => {
  it("extracts the endpoint id and strips the -pooler infix", () => {
    expect(neonEndpointId("ep-mute-mountain-ap2ca575-pooler.c-7.us-east-1.aws.neon.tech")).toBe(
      "ep-mute-mountain-ap2ca575",
    );
    expect(neonEndpointId("ep-mute-mountain-ap2ca575.c-7.us-east-1.aws.neon.tech")).toBe("ep-mute-mountain-ap2ca575");
  });

  it("returns null for hosts without a Neon endpoint id", () => {
    expect(neonEndpointId("localhost")).toBeNull();
    expect(neonEndpointId("")).toBeNull();
  });
});

describe("endpointIdFromConnectionUri", () => {
  it("reads the endpoint id from a connection string without exposing the password", () => {
    expect(
      endpointIdFromConnectionUri(
        "postgresql://user:s3cret@ep-cold-block-apd1o14r.us-east-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toBe("ep-cold-block-apd1o14r");
  });

  it("returns null for an unparseable uri", () => {
    expect(endpointIdFromConnectionUri("not a url")).toBeNull();
  });
});

describe("hyperdriveIdFromWranglerConfig", () => {
  it("parses JSONC with comments and selects the env binding", () => {
    expect(hyperdriveIdFromWranglerConfig(WRANGLER_CONFIG, "preview")).toBe("7da9ea500b534f3fa522460c8a9f2efc");
    expect(hyperdriveIdFromWranglerConfig(WRANGLER_CONFIG, "production")).toBe("ca07f5b895084f60b666586c362982fc");
  });

  it("returns null when the env has no hyperdrive binding", () => {
    expect(hyperdriveIdFromWranglerConfig(`{"env":{"preview":{}}}`, "preview")).toBeNull();
  });
});

describe("hyperdriveOriginEndpointId", () => {
  it("extracts the origin endpoint id from wrangler output preamble + JSON", () => {
    expect(hyperdriveOriginEndpointId(HYPERDRIVE_GET_OUTPUT)).toBe("ep-mute-mountain-ap2ca575");
  });
});

describe("evaluateBranchDivergence", () => {
  it("passes when both endpoints match", () => {
    const verdict = evaluateBranchDivergence({
      migrationEndpointId: "ep-mute-mountain-ap2ca575",
      hyperdriveEndpointId: "ep-mute-mountain-ap2ca575",
      target: "preview",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.endpointId).toBe("ep-mute-mountain-ap2ca575");
  });

  it("fails and names both endpoints when they diverge", () => {
    const verdict = evaluateBranchDivergence({
      migrationEndpointId: "ep-cold-block-apd1o14r",
      hyperdriveEndpointId: "ep-mute-mountain-ap2ca575",
      target: "preview",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("divergent");
    expect(verdict.message).toContain("ep-cold-block-apd1o14r");
    expect(verdict.message).toContain("ep-mute-mountain-ap2ca575");
    expect(verdict.message).toContain("DATABASE_URL_MIGRATIONS_PREVIEW");
  });

  it("fails when an endpoint cannot be resolved", () => {
    const verdict = evaluateBranchDivergence({
      migrationEndpointId: null,
      hyperdriveEndpointId: "ep-mute-mountain-ap2ca575",
      target: "production",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("unresolved");
  });
});

describe("assertMigrationBranchMatchesHyperdrive", () => {
  it("resolves the right hyperdrive id and passes when branches match", async () => {
    const runWrangler = vi.fn(async () => HYPERDRIVE_GET_OUTPUT);
    const log = vi.fn();
    await assertMigrationBranchMatchesHyperdrive({
      target: "preview",
      migrationUrl: "postgresql://platform_admin:pw@ep-mute-mountain-ap2ca575.us-east-1.aws.neon.tech/neondb",
      configText: WRANGLER_CONFIG,
      runWrangler,
      log,
    });
    expect(runWrangler).toHaveBeenCalledWith(["hyperdrive", "get", "7da9ea500b534f3fa522460c8a9f2efc"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ep-mute-mountain-ap2ca575"));
  });

  it("throws when the migration URL targets a different branch than Hyperdrive", async () => {
    await expect(
      assertMigrationBranchMatchesHyperdrive({
        target: "preview",
        migrationUrl: "postgresql://platform_admin:pw@ep-cold-block-apd1o14r.us-east-1.aws.neon.tech/neondb",
        configText: WRANGLER_CONFIG,
        runWrangler: async () => HYPERDRIVE_GET_OUTPUT,
        log: () => {},
      }),
    ).rejects.toThrow(/Neon branch divergence/);
  });
});
