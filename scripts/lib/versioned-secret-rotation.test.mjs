import { describe, expect, it, vi } from "vitest";
import { profilePersistsKidInRecords, VERSIONED_SECRET_PROFILES } from "./rotation-profiles.mjs";
import {
  bindingsForTarget,
  collectSnapshot,
  executeStep,
  formatPlan,
  parseOptions,
  parseProfileId,
  parseTarget,
} from "./versioned-secret-rotation.mjs";

const contentSigning = VERSIONED_SECRET_PROFILES["content-signing"];
const apiKeyPepper = VERSIONED_SECRET_PROFILES["api-key-pepper"];
const artifactBytesEncryption = VERSIONED_SECRET_PROFILES["artifact-bytes-encryption"];

describe("parseProfileId", () => {
  it("returns the profile for a known id", () => {
    expect(parseProfileId("content-signing")).toBe(contentSigning);
  });

  it("throws listing valid profiles for an unknown id", () => {
    expect(() => parseProfileId("nope")).toThrow(/Unknown rotation profile/);
    expect(() => parseProfileId("nope")).toThrow(/content-signing/);
  });
});

describe("parseTarget", () => {
  it("accepts preview and production", () => {
    expect(parseTarget(["preview"])).toBe("preview");
    expect(parseTarget(["production"])).toBe("production");
  });

  it("ignores flags when locating the positional target", () => {
    expect(parseTarget(["--dry-run", "production"])).toBe("production");
  });

  it("rejects any other environment", () => {
    expect(() => parseTarget(["staging"])).toThrow(/preview or production/);
  });
});

describe("parseOptions", () => {
  it("parses flags and inline + spaced option values", () => {
    const opts = parseOptions(["--step", "stage", "--value", "abc", "--operator=me@x", "--dry-run", "--force"]);
    expect(opts).toMatchObject({ step: "stage", value: "abc", operator: "me@x", dryRun: true, force: true });
  });

  it("reads secret material from --value-env", () => {
    const opts = parseOptions(["--step", "stage", "--value-env", "ROTATION_SECRET"], {
      ROTATION_SECRET: "env-secret",
    });
    expect(opts).toMatchObject({
      value: "env-secret",
      valueSource: "env",
      valueEnvName: "ROTATION_SECRET",
    });
  });

  it("rejects argv secret material under pnpm rotation scripts", () => {
    expect(() =>
      parseOptions(["--step", "stage", "--value", "abc"], {
        npm_lifecycle_event: "secrets:rotate:artifact-bytes:production",
      }),
    ).toThrow(/--value-env/);
  });

  it("rejects both --value and --value-env", () => {
    expect(() =>
      parseOptions(["--step", "stage", "--value", "abc", "--value-env", "ROTATION_SECRET"], {
        ROTATION_SECRET: "env-secret",
      }),
    ).toThrow(/only one/);
  });

  it("rejects empty --value-env material", () => {
    expect(() => parseOptions(["--step", "stage", "--value-env", "ROTATION_SECRET"], {})).toThrow(/ROTATION_SECRET/);
  });

  it("defaults the operator to the rotation agent identity", () => {
    expect(parseOptions(["--step", "flip"]).operator).toBe("rotation-agent@platform");
  });

  it("requires --step", () => {
    expect(() => parseOptions([])).toThrow(/Missing required --step/);
  });

  it("rejects an invalid --step", () => {
    expect(() => parseOptions(["--step", "rollback"])).toThrow(/Invalid --step/);
  });

  it("rejects an empty --value", () => {
    expect(() => parseOptions(["--step", "stage", "--value="])).toThrow(/non-empty secret/);
  });

  it("rejects a --value flag with no following argument", () => {
    expect(() => parseOptions(["--step", "stage", "--value", "--force"])).toThrow(/Missing value for --value/);
  });
});

describe("bindingsForTarget", () => {
  it("maps each profile binding to an env-scoped worker with both secret names", () => {
    const bindings = bindingsForTarget(contentSigning, "preview");
    expect(bindings.map((b) => b.worker)).toEqual([
      "agent-paste-api-preview",
      "agent-paste-upload-preview",
      "agent-paste-content-preview",
      "agent-paste-jobs-preview",
    ]);
    expect(bindings[0].names).toEqual(["CONTENT_SIGNING_SECRET", "CONTENT_SIGNING_SECRET_V2"]);
  });

  it("includes api in artifact-bytes-encryption bindings", () => {
    const bindings = bindingsForTarget(artifactBytesEncryption, "production");
    expect(bindings.map((b) => b.worker)).toEqual([
      "agent-paste-api-production",
      "agent-paste-upload-production",
      "agent-paste-content-production",
      "agent-paste-jobs-production",
    ]);
    expect(bindings[0].names).toEqual(["ARTIFACT_BYTES_ENCRYPTION_KEY", "ARTIFACT_BYTES_ENCRYPTION_KEY_V2"]);
  });
});

describe("formatPlan", () => {
  const boundBoth = { primaryBound: true, secondaryBound: true };
  const primaryOnly = { primaryBound: true, secondaryBound: false };

  it("stage: lists the secondary put per worker and the kid hold", () => {
    const plan = formatPlan(contentSigning, "preview", "stage", primaryOnly, "op@x", "<generated>");
    expect(plan).toContain("wrangler secret put CONTENT_SIGNING_SECRET_V2 --name agent-paste-api-preview");
    expect(plan).toContain("Keep CONTENT_SIGNING_KID=v1 until flip.");
    expect(plan).toContain("Operator identity (audit): op@x");
  });

  it("stage: warns when the primary is unbound and the secondary already exists", () => {
    const plan = formatPlan(
      contentSigning,
      "preview",
      "stage",
      { primaryBound: false, secondaryBound: true },
      "op",
      "x",
    );
    expect(plan).toContain("Primary secret is not bound");
    expect(plan).toContain("CONTENT_SIGNING_SECRET_V2 is already bound.");
  });

  it("flip: emits a deploy with kid v2 per worker and warns when secondary unbound", () => {
    const plan = formatPlan(contentSigning, "production", "flip", primaryOnly, "op", "x");
    expect(plan).toContain("Bind CONTENT_SIGNING_SECRET_V2 on every Worker before flip.");
    expect(plan).toContain("--var CONTENT_SIGNING_KID:v2");
    expect(plan).toContain("agent-paste-api-production");
  });

  it("drain: prints the profile drain hint and the follow-up drop command", () => {
    const plan = formatPlan(apiKeyPepper, "production", "drain", boundBoth, "op", "x");
    expect(plan).toContain("pepper_kid=1");
    expect(plan).toContain("--step drop");
    expect(plan).toContain("pnpm smoke:production");
  });

  it("drop (kid-persisting profile): deletes kid 1 and keeps kid var at v2", () => {
    const plan = formatPlan(apiKeyPepper, "preview", "drop", boundBoth, "op", "x");
    expect(plan).toContain("Drop kid 1 only");
    expect(plan).toContain("wrangler secret delete API_KEY_PEPPER_V1");
    expect(plan).not.toContain("Promote the v2 value");
  });

  it("drop (signing profile): promotes v2 into primary and deletes _V2", () => {
    const plan = formatPlan(contentSigning, "production", "drop", boundBoth, "op", "x");
    expect(plan).toContain("Promote the v2 value");
    expect(plan).toContain("wrangler secret put CONTENT_SIGNING_SECRET --name agent-paste-api-production");
    expect(plan).toContain("wrangler secret delete CONTENT_SIGNING_SECRET_V2");
  });

  it("emergency: overwrites primary, resets kid v1, and deletes _V2 when bound", () => {
    const plan = formatPlan(contentSigning, "production", "emergency", boundBoth, "op", "<gen>");
    expect(plan).toContain("Emergency cutover");
    expect(plan).toContain("--var CONTENT_SIGNING_KID:v1");
    expect(plan).toContain("wrangler secret delete CONTENT_SIGNING_SECRET_V2");
  });

  it("emergency: skips the _V2 delete when the secondary is not bound", () => {
    const plan = formatPlan(contentSigning, "preview", "emergency", primaryOnly, "op", "<gen>");
    expect(plan).not.toContain("wrangler secret delete CONTENT_SIGNING_SECRET_V2");
  });

  it("emergency: deletes _V2 only for workers where the secondary is bound", () => {
    const plan = formatPlan(
      contentSigning,
      "production",
      "emergency",
      {
        primaryBound: true,
        secondaryBound: true,
        secondaryBoundWorkers: ["agent-paste-content-production"],
      },
      "op",
      "<gen>",
    );
    expect(plan).toContain("wrangler secret delete CONTENT_SIGNING_SECRET_V2 --name agent-paste-content-production");
    expect(plan).not.toContain("wrangler secret delete CONTENT_SIGNING_SECRET_V2 --name agent-paste-api-production");
  });

  it("throws on an unhandled step", () => {
    expect(() => formatPlan(contentSigning, "preview", "bogus", primaryOnly, "op", "x")).toThrow(/Unhandled step/);
  });
});

describe("profilePersistsKidInRecords", () => {
  it("is true for record-bound kid profiles and false for signing profiles", () => {
    expect(profilePersistsKidInRecords("api-key-pepper")).toBe(true);
    expect(profilePersistsKidInRecords("artifact-bytes-encryption")).toBe(true);
    expect(profilePersistsKidInRecords("content-signing")).toBe(false);
    expect(profilePersistsKidInRecords("upload-signing")).toBe(false);
  });
});

describe("collectSnapshot", () => {
  it("reports primary/secondary bound from the union of all worker secret lists", async () => {
    const listWorkerSecrets = vi.fn(async (worker) =>
      worker === "agent-paste-content-preview" ? ["CONTENT_SIGNING_SECRET", "CONTENT_SIGNING_SECRET_V2"] : [],
    );
    const { snapshot } = await collectSnapshot(contentSigning, "preview", { listWorkerSecrets });
    expect(snapshot).toEqual({
      primaryBound: true,
      secondaryBound: true,
      primaryBoundWorkers: ["agent-paste-content-preview"],
      secondaryBoundWorkers: ["agent-paste-content-preview"],
    });
    expect(listWorkerSecrets).toHaveBeenCalledTimes(contentSigning.bindings.length);
  });

  it("reports nothing bound when no worker has the secrets", async () => {
    const { snapshot } = await collectSnapshot(apiKeyPepper, "production", {
      listWorkerSecrets: async () => [],
    });
    expect(snapshot).toEqual({
      primaryBound: false,
      secondaryBound: false,
      primaryBoundWorkers: [],
      secondaryBoundWorkers: [],
    });
  });
});

describe("executeStep", () => {
  function fakeDeps(existingByWorker = {}) {
    return {
      run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
      putWorkerSecret: vi.fn(async () => {}),
      appendRotationAuditRecord: vi.fn(() => {}),
      listWorkerSecrets: vi.fn(async (worker) => existingByWorker[worker] ?? []),
    };
  }

  const stageOptions = { step: "stage", dryRun: false, printOnly: false, operator: "op", force: false };

  it("dry-run performs no writes and records no audit", async () => {
    const deps = fakeDeps();
    await executeStep(contentSigning, "preview", { ...stageOptions, dryRun: true }, { primaryBound: true }, deps);
    expect(deps.putWorkerSecret).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.appendRotationAuditRecord).not.toHaveBeenCalled();
  });

  it("print-only performs no writes", async () => {
    const deps = fakeDeps();
    await executeStep(contentSigning, "preview", { ...stageOptions, printOnly: true }, { primaryBound: true }, deps);
    expect(deps.putWorkerSecret).not.toHaveBeenCalled();
  });

  it("drain is a no-op", async () => {
    const deps = fakeDeps();
    await executeStep(apiKeyPepper, "preview", { ...stageOptions, step: "drain" }, { primaryBound: true }, deps);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.putWorkerSecret).not.toHaveBeenCalled();
  });

  it("stage puts the secondary secret on every binding and writes one audit record", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "preview",
      { ...stageOptions, value: "staged-v2" },
      { primaryBound: true, secondaryBound: false },
      deps,
    );
    expect(deps.putWorkerSecret).toHaveBeenCalledTimes(contentSigning.bindings.length);
    expect(deps.putWorkerSecret).toHaveBeenCalledWith(
      "agent-paste-api-preview",
      "CONTENT_SIGNING_SECRET_V2",
      "staged-v2",
    );
    expect(deps.appendRotationAuditRecord).toHaveBeenCalledWith(expect.objectContaining({ step: "stage" }));
  });

  it("stage refuses to auto-generate over an already-bound secondary without --value", async () => {
    const deps = fakeDeps({
      "agent-paste-api-preview": ["CONTENT_SIGNING_SECRET_V2"],
    });
    await expect(
      executeStep(contentSigning, "preview", stageOptions, { primaryBound: true, secondaryBound: true }, deps),
    ).rejects.toThrow(/already bound/);
    expect(deps.putWorkerSecret).not.toHaveBeenCalled();
  });

  it("flip deploys kid v2 on every binding and records an audit record", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "production",
      { ...stageOptions, step: "flip" },
      { primaryBound: true, secondaryBound: true },
      deps,
    );
    expect(deps.run).toHaveBeenCalledTimes(contentSigning.bindings.length);
    expect(deps.run.mock.calls[0][1]).toContain("CONTENT_SIGNING_KID:v2");
    expect(deps.appendRotationAuditRecord).toHaveBeenCalledWith(expect.objectContaining({ step: "flip" }));
  });

  it("drop on a kid-persisting profile deletes kid 1 and redeploys without requiring --value", async () => {
    const deps = fakeDeps();
    await executeStep(
      apiKeyPepper,
      "preview",
      { ...stageOptions, step: "drop" },
      { primaryBound: true, secondaryBound: true },
      deps,
    );
    const deleteCall = deps.run.mock.calls.find((call) => call[1].includes("delete"));
    expect(deleteCall[1]).toContain("API_KEY_PEPPER_V1");
    expect(deps.appendRotationAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ step: "drop", action: "drop_kid_1" }),
    );
  });

  it("drop on a signing profile requires --value", async () => {
    const deps = fakeDeps();
    await expect(
      executeStep(
        contentSigning,
        "production",
        { ...stageOptions, step: "drop" },
        { primaryBound: true, secondaryBound: true },
        deps,
      ),
    ).rejects.toThrow(/--value/);
  });

  it("drop on a signing profile with --value promotes v2 into primary and deletes _V2", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "production",
      { ...stageOptions, step: "drop", value: "promoted" },
      { primaryBound: true, secondaryBound: true },
      deps,
    );
    expect(deps.putWorkerSecret).toHaveBeenCalledWith(
      "agent-paste-api-production",
      "CONTENT_SIGNING_SECRET",
      "promoted",
    );
    const deleteCall = deps.run.mock.calls.find((call) => call[1].includes("delete"));
    expect(deleteCall[1]).toContain("CONTENT_SIGNING_SECRET_V2");
    expect(deps.appendRotationAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ step: "drop", action: "promote_collapse" }),
    );
  });

  it("emergency refuses to overwrite a bound primary without --value-env and --force", async () => {
    const deps = fakeDeps();
    await expect(
      executeStep(
        contentSigning,
        "production",
        { ...stageOptions, step: "emergency" },
        { primaryBound: true, secondaryBound: false },
        deps,
      ),
    ).rejects.toThrow(/--value-env and --force/);
  });

  it("emergency with value material and --force cuts over and deletes _V2", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "production",
      { ...stageOptions, step: "emergency", value: "new-primary", force: true },
      { primaryBound: false, secondaryBound: true },
      deps,
    );
    expect(deps.putWorkerSecret).toHaveBeenCalledWith(
      "agent-paste-api-production",
      "CONTENT_SIGNING_SECRET",
      "new-primary",
    );
    expect(deps.appendRotationAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ step: "emergency", action: "emergency_cutover" }),
    );
  });

  it("emergency with value material and --force skips _V2 delete when not bound", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "production",
      { ...stageOptions, step: "emergency", value: "new-primary", force: true },
      { primaryBound: false, secondaryBound: false },
      deps,
    );
    expect(deps.run).not.toHaveBeenCalledWith(
      "wrangler",
      expect.arrayContaining(["secret", "delete", "CONTENT_SIGNING_SECRET_V2"]),
    );
  });

  it("emergency with value material and --force deletes _V2 only from workers where it is bound", async () => {
    const deps = fakeDeps();
    await executeStep(
      contentSigning,
      "production",
      { ...stageOptions, step: "emergency", value: "new-primary", force: true },
      {
        primaryBound: false,
        secondaryBound: true,
        secondaryBoundWorkers: ["agent-paste-content-production"],
      },
      deps,
    );
    const deleteCalls = deps.run.mock.calls.filter((call) => call[1].includes("delete"));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1]).toEqual([
      "secret",
      "delete",
      "CONTENT_SIGNING_SECRET_V2",
      "--name",
      "agent-paste-content-production",
    ]);
  });
});
