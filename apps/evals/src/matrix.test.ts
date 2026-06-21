import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { createExecutionKey } from "./idempotency";
import { expandRuns } from "./matrix";

describe("expandRuns", () => {
  it("creates stable run ids, fingerprints, and generated claim codes", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const key = createExecutionKey(config, { dryRun: true, fresh: false });
    const first = expandRuns(config, "/tmp/evals", key);
    const second = expandRuns(config, "/tmp/evals", key);

    expect(first.map((run) => run.id)).toEqual(second.map((run) => run.id));
    expect(first.map((run) => run.fingerprint)).toEqual(second.map((run) => run.fingerprint));
    expect(first.map((run) => run.claimCode)).toEqual(second.map((run) => run.claimCode));
  });

  it("changes the execution key when dry-run mode changes", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const dryRun = createExecutionKey(config, { dryRun: true, fresh: false });
    const liveRun = createExecutionKey(config, { dryRun: false, fresh: false });

    expect(dryRun).not.toBe(liveRun);
  });

  it("keeps the execution key stable when only judge config changes", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const changedJudge = { ...config, judge: { ...config.judge, model: "openai/gpt-5.5-test" } };

    expect(createExecutionKey(changedJudge, { dryRun: false, fresh: false })).toBe(
      createExecutionKey(config, { dryRun: false, fresh: false }),
    );
  });
});
