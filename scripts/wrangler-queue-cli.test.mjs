import { describe, expect, it } from "vitest";
import {
  isQueueAlreadyExists,
  isQueueConsumerNotFound,
  isQueueNotFound,
  isQueueStillReferenced,
} from "./wrangler-queue-cli.mjs";

describe("wrangler queue CLI helpers", () => {
  it("treats Cloudflare already-taken queue errors as existing queues", () => {
    expect(
      isQueueAlreadyExists({
        code: 1,
        stdout: "",
        stderr:
          "Queue name 'byte-purge-dlq-preview-pr-100' is already taken. Please use a different name and try again. [code: 11009]",
      }),
    ).toBe(true);
  });

  it("treats generic already-exists messages as existing queues", () => {
    expect(
      isQueueAlreadyExists({
        code: 1,
        stdout: "Queue already exists",
        stderr: "",
      }),
    ).toBe(true);
  });

  it("does not treat unrelated provisioning failures as existing queues", () => {
    expect(
      isQueueAlreadyExists({
        code: 1,
        stdout: "",
        stderr: "Authentication error [code: 10000]",
      }),
    ).toBe(false);
  });

  it("treats not-found delete errors as absent queues", () => {
    expect(
      isQueueNotFound({
        code: 1,
        stdout: "",
        stderr: "Queue does not exist",
      }),
    ).toBe(true);
  });

  it("treats missing queue consumers as already detached", () => {
    expect(
      isQueueConsumerNotFound({
        code: 1,
        stdout: "",
        stderr: "Worker is not configured as a consumer for this queue",
      }),
    ).toBe(true);
  });

  it("detects queue delete failures caused by Worker bindings", () => {
    expect(
      isQueueStillReferenced({
        code: 1,
        stdout: "",
        stderr:
          "Cannot delete queue 'byte-purge-preview-pr-114' that is still referenced by a binding in a Worker. Unbind queue 'byte-purge-preview-pr-114' from the Workers 'agent-paste-jobs-pr-114'; then try again. [code: 11005]",
      }),
    ).toBe(true);
  });
});
