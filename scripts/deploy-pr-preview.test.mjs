import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(new URL("deploy-pr-preview.mjs", import.meta.url));

describe("deploy-pr-preview generated configs", () => {
  it.each([
    { sentryDsn: "", webEnabled: false, sentryRelease: "" },
    { sentryDsn: "https://public@example.ingest.us.sentry.io/1", webEnabled: false },
    {
      sentryDsn: "https://public@example.ingest.us.sentry.io/1",
      webEnabled: true,
      sentryRelease: "agent-paste@pr:build",
    },
  ])("preserves routing, security, and observability with $sentryDsn and Web $webEnabled", ({
    sentryDsn,
    webEnabled,
    sentryRelease = "",
  }) => {
    const prNumber = "999173";
    const fakeBin = mkdtempSync(join(tmpdir(), "agent-paste-pr-preview-"));
    const fakePnpm = join(fakeBin, "pnpm");
    const callsPath = join(fakeBin, "calls.jsonl");
    const expectedRelease =
      sentryRelease || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const outDir = new URL(`../.wrangler/pr-preview/pr-${prNumber}/`, import.meta.url);
    const webConfigPath = fileURLToPath(new URL("../apps/web/dist/server/wrangler.json", import.meta.url));
    const originalWebConfig = existsSync(webConfigPath) ? readFileSync(webConfigPath) : undefined;
    const webSourcePath = new URL("../apps/web/wrangler.jsonc", import.meta.url);
    const webSource = parseConfigFileTextToJson(webSourcePath.pathname, readFileSync(webSourcePath, "utf8")).config;
    const webFixture = { observability: webSource.observability, vars: {} };

    writeFileSync(
      fakePnpm,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ args: process.argv.slice(2), release: process.env.SENTRY_RELEASE }) + "\\n");
if (process.argv.includes("@agent-paste/web") && process.argv.includes("build")) {
  const configPath = ${JSON.stringify(webConfigPath)};
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, ${JSON.stringify(JSON.stringify(webFixture))});
}
process.exit(0);
`,
    );
    chmodSync(fakePnpm, 0o755);
    rmSync(outDir, { recursive: true, force: true });

    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          PR_NUMBER: prNumber,
          PR_HYPERDRIVE_ID: "hd_test_pr_preview",
          CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
          PR_PREVIEW_SECRET_SEED: "deterministic-pr-preview-seed",
          WORKOS_PREVIEW_API_KEY: webEnabled ? "wk_test_pr_preview" : "",
          SENTRY_DSN: sentryDsn,
          SENTRY_RELEASE: sentryRelease,
        },
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `deploy-pr-preview exited ${result.status}`);
      }
      const calls = readFileSync(callsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const deployCalls = calls.filter(({ args }) => args.includes("deploy"));
      expect(deployCalls).toHaveLength(webEnabled ? 6 : 5);
      for (const { args, release } of deployCalls) {
        expect(args[args.indexOf("--var") + 1]).toBe(`SENTRY_RELEASE:${expectedRelease}`);
        expect(release).toBe(expectedRelease);
      }
      const buildCalls = calls.filter(({ args }) => args.includes("build"));
      expect(buildCalls).toHaveLength(webEnabled ? 2 : 1);
      for (const call of buildCalls) expect(call.release).toBe(expectedRelease);

      const api = JSON.parse(readFileSync(new URL("api.json", outDir), "utf8"));
      const upload = JSON.parse(readFileSync(new URL("upload.json", outDir), "utf8"));
      const content = JSON.parse(readFileSync(new URL("content.json", outDir), "utf8"));
      for (const app of ["api", "upload", "content", "jobs", "apex"]) {
        const config = JSON.parse(readFileSync(new URL(`${app}.json`, outDir), "utf8"));
        const sourcePath = new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url);
        const source = parseConfigFileTextToJson(sourcePath.pathname, readFileSync(sourcePath, "utf8")).config;
        expect(config.observability).toEqual(source.env?.preview?.observability ?? source.observability);
        const secrets = JSON.parse(readFileSync(new URL(`${app}.secrets.json`, outDir), "utf8"));
        if (sentryDsn) {
          expect(secrets.SENTRY_DSN).toBe(sentryDsn);
        } else {
          expect(secrets).not.toHaveProperty("SENTRY_DSN");
        }
      }
      if (webEnabled) {
        const web = JSON.parse(readFileSync(webConfigPath, "utf8"));
        expect(web.observability).toEqual(webSource.observability);
        const webSecrets = JSON.parse(readFileSync(new URL("web.secrets.json", outDir), "utf8"));
        expect(webSecrets).toMatchObject({ WORKOS_API_KEY: "wk_test_pr_preview", SENTRY_DSN: sentryDsn });
      }
      expect(api.placement).toEqual({ mode: "targeted", region: "aws:us-east-1" });
      expect(upload.placement).toEqual({ mode: "targeted", region: "aws:us-east-1" });
      expect(content).not.toHaveProperty("placement");
      expect(api.durable_objects.bindings).toEqual(
        expect.arrayContaining([
          { name: "WRITE_ALLOWANCE", class_name: "WorkspaceWriteAllowance" },
          { name: "EPHEMERAL_PROVISION_GATE", class_name: "EphemeralProvisionGate" },
        ]),
      );
      expect(api.migrations).toEqual(
        expect.arrayContaining([
          { tag: "v1-write-allowance", new_sqlite_classes: ["WorkspaceWriteAllowance"] },
          { tag: "v2-ephemeral-provision-gate", new_sqlite_classes: ["EphemeralProvisionGate"] },
        ]),
      );
      expect(api.ratelimits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ARTIFACT_RATE_LIMIT",
            namespace_id: `4${prNumber}003`,
            simple: { limit: 600, period: 60 },
          }),
          expect.objectContaining({
            name: "EPHEMERAL_PROVISION_IP_RATE_LIMIT",
            simple: { limit: 10, period: 60 },
          }),
          expect.objectContaining({
            name: "EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT",
            simple: { limit: 300, period: 60 },
          }),
        ]),
      );
      expect(api.vars).toMatchObject({
        CONTENT_BASE_URL: "https://agent-paste-content-pr-999173.example-subdomain.workers.dev",
        CONTENT_CAPABILITY_DOMAIN: "agent-paste.link",
        CONTENT_CAPABILITY_HOST_SUFFIX: "-pr-999173",
      });
      expect(upload.vars).toMatchObject({
        CONTENT_BASE_URL: "https://agent-paste-content-pr-999173.example-subdomain.workers.dev",
        CONTENT_CAPABILITY_DOMAIN: "agent-paste.link",
        CONTENT_CAPABILITY_HOST_SUFFIX: "-pr-999173",
      });
      expect(content.vars).toMatchObject({
        CONTENT_BASE_URL: "https://agent-paste-content-pr-999173.example-subdomain.workers.dev",
        CONTENT_CAPABILITY_DOMAIN: "agent-paste.link",
        CONTENT_CAPABILITY_HOST_SUFFIX: "-pr-999173",
      });
      expect(content.ratelimits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ARTIFACT_RATE_LIMIT",
            namespace_id: `4${prNumber}003`,
            simple: { limit: 600, period: 60 },
          }),
          expect.objectContaining({
            name: "CAPABILITY_LOOKUP_RATE_LIMIT",
            namespace_id: `4${prNumber}006`,
            simple: { limit: 3000, period: 60 },
          }),
        ]),
      );
      expect(content.routes).toEqual([
        {
          pattern: "*-pr-999173.agent-paste.link/*",
          zone_name: "agent-paste.link",
        },
      ]);
    } finally {
      if (webEnabled) {
        if (originalWebConfig) {
          writeFileSync(webConfigPath, originalWebConfig);
        } else {
          rmSync(webConfigPath, { force: true });
        }
      }
      rmSync(outDir, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});

describe("Worker observability export contract", () => {
  it.each([undefined, "preview", "production"])("routes telemetry safely in %s", (environment) => {
    for (const app of ["api", "upload", "content", "jobs", "mcp", "apex", "web", "stream"]) {
      const path = new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url);
      const config = parseConfigFileTextToJson(path.pathname, readFileSync(path, "utf8")).config;
      const observability = config.env?.[environment]?.observability ?? config.observability;
      expect(observability.enabled).toBe(true);
      expect(observability.logs).toMatchObject({ enabled: true, destinations: ["axiom-logs"] });
      if (app === "upload" || app === "content") {
        expect(observability.logs.invocation_logs).toBe(false);
        expect(observability.traces.enabled).toBe(false);
        expect(observability.traces.destinations ?? []).toEqual([]);
      } else {
        expect(observability.traces).toMatchObject({
          enabled: true,
          destinations: ["axiom-traces", "sentry-agent-paste-traces"],
        });
      }
      const vars = environment ? config.env[environment].vars : config.vars;
      expect(Number(vars.SENTRY_TRACES_SAMPLE_RATE ?? "1")).toBe(1);
    }
  });
});

describe("content read deployment budgets", () => {
  it.each([undefined, "preview", "production"])("supports image-heavy browsing in %s", (environment) => {
    const configs = ["api", "content"].map((app) => {
      const path = new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url);
      const parsed = parseConfigFileTextToJson(path.pathname, readFileSync(path, "utf8"));
      expect(parsed.error).toBeUndefined();
      return environment ? parsed.config.env[environment] : parsed.config;
    });
    const [api, content] = configs;
    const artifact = content.ratelimits.find((binding) => binding.name === "ARTIFACT_RATE_LIMIT");
    expect(artifact.simple).toEqual({ limit: 600, period: 60 });
    expect(api.ratelimits.find((binding) => binding.name === "ARTIFACT_RATE_LIMIT")).toEqual(artifact);
    expect(content.ratelimits.find((binding) => binding.name === "CAPABILITY_LOOKUP_RATE_LIMIT").simple).toEqual({
      limit: 3000,
      period: 60,
    });
    expect(api.ratelimits.find((binding) => binding.name === "ACTOR_RATE_LIMIT").simple).toEqual({
      limit: 60,
      period: 60,
    });
    expect(api.ratelimits.find((binding) => binding.name === "WORKSPACE_BURST_CAP").simple).toEqual({
      limit: 300,
      period: 10,
    });
  });
});
