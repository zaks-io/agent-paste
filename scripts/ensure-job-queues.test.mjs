import { describe, expect, it, vi } from "vitest";
import { ensureJobQueues } from "./ensure-job-queues.mjs";

describe("ensureJobQueues", () => {
  it("creates queues in order and treats already-exists as success", async () => {
    const created = [];
    const run = vi.fn(async (_command, args) => {
      const queueName = args[4];
      created.push(queueName);
      if (queueName.endsWith("-dlq-preview")) {
        return { code: 1, stdout: "", stderr: "Queue already exists" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await ensureJobQueues(["byte-purge-dlq-preview", "bundle-generate-preview"], { run, log: () => {} });

    expect(created).toEqual(["byte-purge-dlq-preview", "bundle-generate-preview"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("throws when queue creation fails for a new error", async () => {
    const run = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "Authentication error [code: 10000]",
    }));

    await expect(ensureJobQueues(["bundle-generate-production"], { run, log: () => {} })).rejects.toThrow(
      /Failed to create queue bundle-generate-production/,
    );
  });
});
