import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalEnvSecrets, LOCAL_SECRET_KEYS } from "./local-env-secrets.mjs";

describe("local-env-secrets", () => {
  let dir;
  let envPath;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ap-localenv-"));
    envPath = join(dir, ".env");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates all local secret keys when .env is absent", () => {
    const { generated, present } = ensureLocalEnvSecrets(envPath);
    expect(generated).toEqual(LOCAL_SECRET_KEYS);
    expect(present).toEqual([]);
    const written = readFileSync(envPath, "utf8");
    for (const key of LOCAL_SECRET_KEYS) {
      expect(written).toMatch(new RegExp(`^${key}=.+$`, "m"));
    }
  });

  it("is idempotent: re-running generates nothing new and preserves values", () => {
    ensureLocalEnvSecrets(envPath);
    const first = readFileSync(envPath, "utf8");
    const { generated, present } = ensureLocalEnvSecrets(envPath);
    expect(generated).toEqual([]);
    expect(present).toEqual(LOCAL_SECRET_KEYS);
    expect(readFileSync(envPath, "utf8")).toBe(first);
  });

  it("fills only missing keys and leaves existing lines untouched", () => {
    writeFileSync(envPath, "EXISTING_VAR=keepme\nSMOKE_HARNESS_SECRET=mine\n");
    const { generated, present } = ensureLocalEnvSecrets(envPath);
    expect(present).toContain("SMOKE_HARNESS_SECRET");
    expect(generated).not.toContain("SMOKE_HARNESS_SECRET");
    const written = readFileSync(envPath, "utf8");
    expect(written).toContain("EXISTING_VAR=keepme");
    expect(written).toMatch(/^SMOKE_HARNESS_SECRET=mine$/m);
    expect(written).toMatch(/^AGENT_PASTE_API_KEY_PEPPER=.+$/m);
  });

  it("generates high-entropy distinct values per key", () => {
    ensureLocalEnvSecrets(envPath);
    const written = readFileSync(envPath, "utf8");
    const values = LOCAL_SECRET_KEYS.map((key) => written.match(new RegExp(`^${key}=(.+)$`, "m"))[1]);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value.length).toBeGreaterThanOrEqual(43);
    }
  });
});
