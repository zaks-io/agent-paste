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

  it("retries transient Cloudflare 10013 errors and succeeds", async () => {
    let attempts = 0;
    const run = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        return { code: 1, stdout: "", stderr: "An unknown error has occurred. [code: 10013]" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const sleep = vi.fn(async () => {});

    await ensureJobQueues(["safety-scan-preview-pr-1"], { run, log: () => {}, sleep });

    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after max attempts when 10013 persists", async () => {
    const run = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "An unknown error has occurred. [code: 10013]",
    }));
    const sleep = vi.fn(async () => {});

    await expect(ensureJobQueues(["safety-scan-preview-pr-1"], { run, log: () => {}, sleep })).rejects.toThrow(
      /Failed to create queue safety-scan-preview-pr-1/,
    );
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry deterministic creation errors", async () => {
    const run = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "Authentication error [code: 10000]",
    }));
    const sleep = vi.fn(async () => {});

    await expect(ensureJobQueues(["bundle-generate-production"], { run, log: () => {}, sleep })).rejects.toThrow(
      /Failed to create queue bundle-generate-production/,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
