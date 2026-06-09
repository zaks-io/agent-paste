import { describe, expect, it, vi } from "vitest";
import {
  assertDeployScopeAllowed,
  createSecretPlanner,
  formatForbiddenProductionSecretsMessage,
  formatMissingProviderSecretsMessage,
  GENERATABLE,
  generatedByteLength,
  runDeployPlan,
  selectApps,
  shouldMigrate,
  TRANSIENT_32_BYTE_SECRETS,
  turboDeployArgs,
} from "./deploy.mjs";
import { workerName } from "./wrangler-secrets.mjs";

/** Deterministic randomBytes stand-in for stable generated-value assertions. */
function deterministicRandomBytes(size) {
  return Buffer.alloc(size, 0xab);
}

/** Minimal preview env with required provider-issued secrets populated. */
function previewEnv(overrides = {}) {
  return {
    PREVIEW_WORKOS_API_KEY: "wk_test_mock_provider_key",
    PREVIEW_WORKOS_COOKIE_PASSWORD: "cookie-password-mock-32-chars-minimum!",
    ...overrides,
  };
}

/** Minimal production env with required provider-issued secrets populated. */
function productionEnv(overrides = {}) {
  return {
    PRODUCTION_WORKOS_API_KEY: "wk_live_mock_provider_key",
    PRODUCTION_WORKOS_COOKIE_PASSWORD: "cookie-password-mock-32-chars-minimum!",
    ...overrides,
  };
}

function listNoSecrets() {
  return async () => [];
}

const FULL_FLEET = ["stream", "api", "upload", "content", "jobs", "mcp", "apex", "web"];

describe("selectApps", () => {
  it("returns the full fleet with no --app flag", () => {
    expect(selectApps(["preview"])).toEqual(FULL_FLEET);
  });

  it("returns only the named app", () => {
    expect(selectApps(["preview", "--app=apex"])).toEqual(["apex"]);
  });

  it("preserves canonical order regardless of flag order", () => {
    expect(selectApps(["preview", "--app=web,api"])).toEqual(["api", "web"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(selectApps(["preview", "--app= apex , , web "])).toEqual(["apex", "web"]);
  });

  it("throws loud on an empty app scope", () => {
    expect(() => selectApps(["preview", "--app="])).toThrow(/Empty --app value/);
    expect(() => selectApps(["preview", "--app= , "])).toThrow(/Empty --app value/);
  });

  it("throws loud on an unknown app name", () => {
    expect(() => selectApps(["preview", "--app=marketing"])).toThrow(/Unknown --app value\(s\): marketing/);
  });
});

describe("shouldMigrate", () => {
  it("migrates for the full fleet", () => {
    expect(shouldMigrate(FULL_FLEET, false)).toBe(true);
  });

  it("skips migration for a DB-free app like apex", () => {
    expect(shouldMigrate(["apex"], false)).toBe(false);
  });

  it("skips migration for a set of only DB-free apps", () => {
    expect(shouldMigrate(["stream", "content", "mcp", "apex", "web"], false)).toBe(false);
  });

  it("migrates when the set includes a DB-backed app", () => {
    expect(shouldMigrate(["apex", "api"], false)).toBe(true);
  });

  it("never migrates when --no-migrate is set, even with DB apps", () => {
    expect(shouldMigrate(["api", "upload", "jobs"], true)).toBe(false);
  });
});

describe("assertDeployScopeAllowed", () => {
  it("allows scoped preview deploys", () => {
    expect(() => assertDeployScopeAllowed(["apex"], "preview")).not.toThrow();
  });

  it("allows full-fleet production deploys", () => {
    expect(() => assertDeployScopeAllowed(FULL_FLEET, "production")).not.toThrow();
  });

  it("rejects scoped production deploys", () => {
    expect(() => assertDeployScopeAllowed(["api"], "production")).toThrow(
      /Production deploys must deploy the full fleet/,
    );
  });
});

describe("turboDeployArgs", () => {
  it("uses no --filter for a full-fleet deploy", () => {
    expect(turboDeployArgs(FULL_FLEET, "preview")).toEqual(["exec", "turbo", "run", "deploy:preview"]);
  });

  it("adds one --filter per scoped app", () => {
    expect(turboDeployArgs(["apex"], "preview")).toEqual([
      "exec",
      "turbo",
      "run",
      "deploy:preview",
      "--filter=@agent-paste/apex",
    ]);
  });

  it("targets the production deploy task for the full fleet", () => {
    expect(turboDeployArgs(FULL_FLEET, "production")).toEqual(["exec", "turbo", "run", "deploy:production"]);
  });

  it("rejects production filters", () => {
    expect(() => turboDeployArgs(["api", "web"], "production")).toThrow(
      /Production deploys must deploy the full fleet/,
    );
  });
});

describe("runDeployPlan deploy step", () => {
  it("binds every selected secret BEFORE the single turbo deploy call", async () => {
    // content consumes CONTENT_SIGNING_SECRET + ARTIFACT_BYTES_ENCRYPTION_KEY, both
    // generatable, so this exercises real provisioning (unlike apex, which has none).
    const calls = [];
    const planner = createSecretPlanner({
      target: "preview",
      env: previewEnv(),
      listSecretsForWorker: listNoSecrets(),
      randomBytesFn: deterministicRandomBytes,
    });
    const provisionPlan = await planner.buildProvisionPlan(["content"]);
    expect(provisionPlan.get("content")?.length).toBeGreaterThan(0);

    const runFn = vi.fn(async () => {
      calls.push("provision");
    });
    const deployFn = vi.fn(async (apps, target) => {
      calls.push(`deploy:${apps.join("+")}:${target}`);
    });

    await runDeployPlan({
      target: "preview",
      planner,
      provisionPlan,
      apps: ["content"],
      runFn,
      deployFn,
      failFn: () => {
        throw new Error("should not fail");
      },
      write: () => {},
    });

    // Secrets bound first, then exactly one turbo deploy over the scoped set.
    expect(calls.at(-1)).toBe("deploy:content:preview");
    expect(calls.indexOf("provision")).toBeLessThan(calls.indexOf("deploy:content:preview"));
    expect(deployFn).toHaveBeenCalledOnce();
    expect(deployFn).toHaveBeenCalledWith(["content"], "preview");
  });

  it("deploys an app with no secrets in a single turbo call (no provisioning)", async () => {
    const planner = createSecretPlanner({
      target: "preview",
      env: previewEnv(),
      listSecretsForWorker: listNoSecrets(),
      randomBytesFn: deterministicRandomBytes,
    });
    const provisionPlan = await planner.buildProvisionPlan(["apex"]);
    const runFn = vi.fn(async () => {});
    const deployFn = vi.fn(async () => {});

    await runDeployPlan({
      target: "preview",
      planner,
      provisionPlan,
      apps: ["apex"],
      runFn,
      deployFn,
      failFn: () => {
        throw new Error("should not fail");
      },
      write: () => {},
    });

    expect(runFn).not.toHaveBeenCalled();
    expect(deployFn).toHaveBeenCalledOnce();
    expect(deployFn).toHaveBeenCalledWith(["apex"], "preview");
  });
});

describe("deploy secret planning", () => {
  describe("generatedByteLength", () => {
    it("uses 32 bytes for transient harness/internal secrets", () => {
      for (const name of TRANSIENT_32_BYTE_SECRETS) {
        expect(generatedByteLength(name)).toBe(32);
      }
    });

    it("uses 48 bytes for cryptographic signing/pepper/encryption secrets", () => {
      for (const name of GENERATABLE) {
        if (!TRANSIENT_32_BYTE_SECRETS.has(name)) {
          expect(generatedByteLength(name)).toBe(48);
        }
      }
    });
  });

  describe("missing required provider secrets", () => {
    it("fails before any mocked secret write when a required provider secret is absent", async () => {
      const bulkRun = vi.fn(async () => {});
      const deployFn = vi.fn(async () => {});
      const failFn = vi.fn((message) => {
        throw new Error(message);
      });

      const planner = createSecretPlanner({
        target: "preview",
        env: {},
        listSecretsForWorker: listNoSecrets(),
        randomBytesFn: deterministicRandomBytes,
      });

      const plan = await planner.buildProvisionPlan();
      expect(plan.missingProvider.length).toBeGreaterThan(0);
      expect(plan.missingProvider.some((entry) => entry.includes("WORKOS_API_KEY"))).toBe(true);

      await expect(
        runDeployPlan({
          target: "preview",
          planner,
          provisionPlan: plan,
          apps: ["api"],
          runFn: bulkRun,
          deployFn,
          failFn,
          write: () => {},
        }),
      ).rejects.toThrow(/WORKOS_API_KEY/);
      expect(failFn).toHaveBeenCalledOnce();
      expect(failFn.mock.calls[0][0]).toBe(formatMissingProviderSecretsMessage(plan.missingProvider));
      expect(bulkRun).not.toHaveBeenCalled();
      expect(deployFn).not.toHaveBeenCalled();
    });
  });

  describe("generated shared values", () => {
    it("reuses one generated value for the same secret across consumers", () => {
      const planner = createSecretPlanner({
        target: "preview",
        env: previewEnv(),
        listSecretsForWorker: listNoSecrets(),
        randomBytesFn: deterministicRandomBytes,
      });

      const fromApi = planner.valueFor("CONTENT_SIGNING_SECRET");
      const fromUpload = planner.valueFor("CONTENT_SIGNING_SECRET");
      const fromContent = planner.valueFor("CONTENT_SIGNING_SECRET");

      expect(fromApi).toBe(fromUpload);
      expect(fromApi).toBe(fromContent);
      expect(fromApi).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(fromApi, "base64url").length).toBe(48);
    });

    it("prefers environment values over generation without logging the value", () => {
      const secretValue = "env-provided-signing-secret-not-in-logs";
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const planner = createSecretPlanner({
        target: "preview",
        env: previewEnv({ PREVIEW_CONTENT_SIGNING_SECRET: secretValue }),
        listSecretsForWorker: listNoSecrets(),
        randomBytesFn: deterministicRandomBytes,
      });

      expect(planner.valueFor("CONTENT_SIGNING_SECRET")).toBe(secretValue);

      const logged = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls].map(([chunk]) => String(chunk)).join("");
      expect(logged).not.toContain(secretValue);

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });

  describe("smoke-forced rotation", () => {
    it("re-provisions SMOKE_HARNESS_SECRET when --smoke is set even if it already exists", async () => {
      const allSecretsPresent = async (worker) => {
        if (worker === workerName("api", "preview")) {
          return [
            "CONTENT_SIGNING_SECRET",
            "API_KEY_PEPPER_V1",
            "ACCESS_LINK_SIGNING_KEY_V1",
            "EPHEMERAL_POW_SECRET",
            "STREAM_INTERNAL_SECRET",
            "WORKOS_API_KEY",
            "SMOKE_HARNESS_SECRET",
          ];
        }
        if (worker === workerName("jobs", "preview")) {
          return ["CONTENT_SIGNING_SECRET", "ARTIFACT_BYTES_ENCRYPTION_KEY", "SMOKE_HARNESS_SECRET"];
        }
        return ["WORKOS_API_KEY"];
      };

      const withoutSmoke = createSecretPlanner({
        target: "preview",
        runSmoke: false,
        env: previewEnv(),
        listSecretsForWorker: allSecretsPresent,
        randomBytesFn: deterministicRandomBytes,
      });
      const planWithoutSmoke = await withoutSmoke.buildProvisionPlan();
      expect(planWithoutSmoke.get("api") ?? []).not.toContain("SMOKE_HARNESS_SECRET");
      expect(planWithoutSmoke.get("jobs") ?? []).not.toContain("SMOKE_HARNESS_SECRET");

      const withSmoke = createSecretPlanner({
        target: "preview",
        runSmoke: true,
        env: previewEnv({ PREVIEW_SMOKE_HARNESS_SECRET: "stale-harness-secret" }),
        listSecretsForWorker: allSecretsPresent,
        randomBytesFn: deterministicRandomBytes,
      });
      const planWithSmoke = await withSmoke.buildProvisionPlan();
      expect(planWithSmoke.get("api")).toContain("SMOKE_HARNESS_SECRET");
      expect(planWithSmoke.get("jobs")).toContain("SMOKE_HARNESS_SECRET");
      expect(withSmoke.generatedValues.get("SMOKE_HARNESS_SECRET")).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(withSmoke.generatedValues.get("SMOKE_HARNESS_SECRET"), "base64url").length).toBe(32);
      expect(withSmoke.valueFor("SMOKE_HARNESS_SECRET")).toBe(withSmoke.generatedValues.get("SMOKE_HARNESS_SECRET"));
      expect(withSmoke.valueFor("SMOKE_HARNESS_SECRET")).not.toBe("stale-harness-secret");
    });

    it("does not provision SMOKE_HARNESS_SECRET for production --smoke", async () => {
      const allSecretsPresent = async () => ["CONTENT_SIGNING_SECRET", "WORKOS_API_KEY"];
      const withProductionSmoke = createSecretPlanner({
        target: "production",
        runSmoke: true,
        env: productionEnv(),
        listSecretsForWorker: allSecretsPresent,
        randomBytesFn: deterministicRandomBytes,
      });

      const plan = await withProductionSmoke.buildProvisionPlan();

      expect(plan.get("api") ?? []).not.toContain("SMOKE_HARNESS_SECRET");
      expect(plan.get("jobs") ?? []).not.toContain("SMOKE_HARNESS_SECRET");
      expect(withProductionSmoke.generatedValues.has("SMOKE_HARNESS_SECRET")).toBe(false);
    });

    it("fails production deploy planning when stale smoke harness secrets are still bound", async () => {
      const bulkRun = vi.fn(async () => {});
      const deployFn = vi.fn(async () => {});
      const failFn = vi.fn((message) => {
        throw new Error(message);
      });
      const listSecretsForWorker = async (worker) => {
        if (worker === workerName("api", "production") || worker === workerName("jobs", "production")) {
          return ["CONTENT_SIGNING_SECRET", "SMOKE_HARNESS_SECRET"];
        }
        return ["WORKOS_API_KEY"];
      };
      const planner = createSecretPlanner({
        target: "production",
        env: productionEnv(),
        listSecretsForWorker,
        randomBytesFn: deterministicRandomBytes,
      });

      const plan = await planner.buildProvisionPlan();

      expect(plan.forbiddenProductionSecrets).toEqual([
        { worker: workerName("api", "production"), name: "SMOKE_HARNESS_SECRET" },
        { worker: workerName("jobs", "production"), name: "SMOKE_HARNESS_SECRET" },
      ]);
      await expect(
        runDeployPlan({
          target: "production",
          planner,
          provisionPlan: plan,
          apps: ["api", "jobs"],
          runFn: bulkRun,
          deployFn,
          failFn,
          write: () => {},
        }),
      ).rejects.toThrow(/SMOKE_HARNESS_SECRET/);
      expect(failFn).toHaveBeenCalledOnce();
      expect(failFn.mock.calls[0][0]).toBe(formatForbiddenProductionSecretsMessage(plan.forbiddenProductionSecrets));
      expect(failFn.mock.calls[0][0]).toContain(
        `wrangler secret delete SMOKE_HARNESS_SECRET --name ${workerName("api", "production")}`,
      );
      expect(failFn.mock.calls[0][0]).toContain(
        `wrangler secret delete SMOKE_HARNESS_SECRET --name ${workerName("jobs", "production")}`,
      );
      expect(bulkRun).not.toHaveBeenCalled();
      expect(deployFn).not.toHaveBeenCalled();
    });
  });

  describe("stdin secret writes", () => {
    it("pipes secret payload to wrangler secret bulk over stdin, never via argv", async () => {
      const runFn = vi.fn(async () => {});
      const planner = createSecretPlanner({
        target: "preview",
        env: previewEnv(),
        listSecretsForWorker: listNoSecrets(),
        randomBytesFn: deterministicRandomBytes,
      });

      const worker = workerName("api", "preview");
      await planner.bulkSetSecrets(worker, ["CONTENT_SIGNING_SECRET", "API_KEY_PEPPER_V1"], runFn);

      expect(runFn).toHaveBeenCalledOnce();
      const [command, args, stdin] = runFn.mock.calls[0];
      expect(command).toBe("pnpm");
      expect(args).toEqual(["exec", "wrangler", "secret", "bulk", "--name", worker]);
      expect(stdin).toBeTruthy();

      const payload = JSON.parse(stdin);
      expect(Object.keys(payload).sort()).toEqual(["API_KEY_PEPPER_V1", "CONTENT_SIGNING_SECRET"]);
      expect(payload.CONTENT_SIGNING_SECRET).toBe(planner.valueFor("CONTENT_SIGNING_SECRET"));

      for (const value of Object.values(payload)) {
        expect(args.join(" ")).not.toContain(value);
      }
    });
  });

  describe("no secret-value logging", () => {
    it("never writes generated secret material to stdout or stderr during bulk provisioning", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const runFn = vi.fn(async () => {});

      const planner = createSecretPlanner({
        target: "preview",
        env: previewEnv(),
        listSecretsForWorker: listNoSecrets(),
        randomBytesFn: deterministicRandomBytes,
      });

      await planner.bulkSetSecrets(workerName("upload", "preview"), ["UPLOAD_SIGNING_SECRET"], runFn);

      const stdinPayload = JSON.parse(runFn.mock.calls[0][2]);
      const secretValue = stdinPayload.UPLOAD_SIGNING_SECRET;
      const logged = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls].map(([chunk]) => String(chunk)).join("");

      expect(secretValue).toBeTruthy();
      expect(logged).not.toContain(secretValue);

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("names missing provider secrets without echoing any secret values", () => {
      const message = formatMissingProviderSecretsMessage([
        "agent-paste-web-preview:WORKOS_COOKIE_PASSWORD",
        "agent-paste-mcp-preview:WORKOS_API_KEY",
      ]);

      expect(message).toContain("WORKOS_COOKIE_PASSWORD");
      expect(message).toContain("wrangler secret put");
      expect(message).not.toMatch(/wk_[a-z0-9_]+/i);
      expect(message).not.toContain("cookie-password");
    });
  });
});
