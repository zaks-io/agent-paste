import { DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL } from "@agent-paste/config";
import { createMemoryWriteAllowanceNamespace, resetMemoryWriteAllowanceCounters } from "@agent-paste/write-allowance";
import { afterEach, describe, expect, it } from "vitest";
import { enforceNewArtifactWriteAllowance } from "./write-allowance.js";

describe("enforceNewArtifactWriteAllowance", () => {
  afterEach(() => {
    resetMemoryWriteAllowanceCounters();
  });
  it("allows publishes until the daily allowance is exhausted", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    for (let index = 0; index < DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL; index += 1) {
      await expect(
        enforceNewArtifactWriteAllowance(writeAllowance, "workspace-a", DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL),
      ).resolves.toEqual({
        ok: true,
      });
    }
    await expect(
      enforceNewArtifactWriteAllowance(writeAllowance, "workspace-a", DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL),
    ).resolves.toMatchObject({
      ok: false,
      retryAfter: expect.any(String),
    });
  });

  it("fails open when the binding is absent", async () => {
    await expect(enforceNewArtifactWriteAllowance(undefined, "workspace-a", 20)).resolves.toEqual({ ok: true });
  });

  it("does not double-count retries that reuse the same idempotency key", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    const idempotencyKey = "idem-fixture-retry-one";
    await expect(
      enforceNewArtifactWriteAllowance(writeAllowance, "workspace-retry", 1, idempotencyKey),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      enforceNewArtifactWriteAllowance(writeAllowance, "workspace-retry", 1, idempotencyKey),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      enforceNewArtifactWriteAllowance(writeAllowance, "workspace-retry", 1, "idem-fixture-other-one"),
    ).resolves.toMatchObject({
      ok: false,
    });
  });
});
