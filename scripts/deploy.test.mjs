import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const deployScript = readFileSync(fileURLToPath(new URL("./deploy.mjs", import.meta.url)), "utf8");

describe("deploy.mjs", () => {
  it("initializes generated secret sizing before top-level deploy awaits", () => {
    const secretSizing = deployScript.indexOf("const TRANSIENT_32_BYTE_SECRETS");
    const generatedByteLength = deployScript.indexOf("function generatedByteLength");
    const firstTopLevelDeployAwait = deployScript.indexOf("await ensureJobQueues");

    expect(secretSizing).toBeGreaterThan(-1);
    expect(generatedByteLength).toBeGreaterThan(-1);
    expect(firstTopLevelDeployAwait).toBeGreaterThan(-1);
    expect(secretSizing).toBeLessThan(firstTopLevelDeployAwait);
    expect(generatedByteLength).toBeLessThan(firstTopLevelDeployAwait);
  });
});
