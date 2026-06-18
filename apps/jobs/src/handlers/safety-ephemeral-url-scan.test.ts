import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { createMockSqlExecutor } from "../test-helpers/mock-sql-executor.js";
import { runEphemeralUrlScanner } from "./safety-ephemeral-url-scan.js";

// Exercises the full handler wiring (AP-376): env creds -> URL Scanner verdict ->
// artifact-scoped Platform Lockdown. The url-scanner unit is covered separately in
// safety/url-scanner.test.ts; here we prove creds flow from `env` and that a
// malicious verdict reaches applyMaliciousUrlLockdown, while an absent cred
// fail-opens to a no-op.

const SCAN_INPUT = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  requestedAt: "2099-01-01T00:00:00.000Z",
};

// Far future so the minted agent-view token's `exp` (derived from the artifact's
// expires_at) never trips the real-clock expiry check and time-bombs the suite.
const ARTIFACT_EXPIRES_AT = "2099-01-02T00:00:00.000Z";

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    API_BASE_URL: "https://api.example.com",
    AGENT_VIEW_SIGNING_SECRET: "agent-view-secret-value-for-tests-1234567890",
    DENYLIST: { put: vi.fn(async () => {}) },
    ...overrides,
  };
}

function trackingExecutor() {
  const sqls: string[] = [];
  const executor = createMockSqlExecutor(
    vi.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("from artifacts")) {
        return { rows: [{ expires_at: ARTIFACT_EXPIRES_AT }] };
      }
      if (sql.includes("from platform_lockdowns")) {
        return { rows: [] };
      }
      if (sql.includes("insert into platform_lockdowns")) {
        return { rows: [{ id: "lkd_test" }] };
      }
      if (sql.includes("idempotency_records")) {
        return { rows: [{ workspace_id: null }] };
      }
      return { rows: [] };
    }),
  );
  return { executor, lockedDown: () => sqls.some((sql) => sql.includes("insert into platform_lockdowns")) };
}

function maliciousScannerFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, result: { uuid: "scan-1" } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { task: { status: "Finished" }, verdicts: { overall: { malicious: true } } },
      }),
    });
}

describe("runEphemeralUrlScanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drives platform lockdown when creds are bound and the URL Scanner verdict is malicious", async () => {
    vi.stubGlobal("fetch", maliciousScannerFetch());
    const { executor, lockedDown } = trackingExecutor();
    const put = vi.fn(async () => {});

    await runEphemeralUrlScanner(
      executor,
      baseEnv({
        URL_SCANNER_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "acct",
        DENYLIST: { put },
      }),
      SCAN_INPUT,
    );

    expect(lockedDown()).toBe(true);
    expect(put).toHaveBeenCalledWith(`ad:${SCAN_INPUT.artifactId}`, expect.any(String), expect.anything());
  });

  it("does not lock down when the verdict is clean", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, result: { uuid: "scan-1" } }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: { task: { status: "Finished" }, verdicts: { overall: { malicious: false } } },
          }),
        }),
    );
    const { executor, lockedDown } = trackingExecutor();

    await runEphemeralUrlScanner(
      executor,
      baseEnv({ URL_SCANNER_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "acct" }),
      SCAN_INPUT,
    );

    expect(lockedDown()).toBe(false);
  });

  it("fails open without contacting the scanner when creds are absent (behavior unchanged)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { executor, lockedDown } = trackingExecutor();

    await runEphemeralUrlScanner(executor, baseEnv(), SCAN_INPUT);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lockedDown()).toBe(false);
  });
});
