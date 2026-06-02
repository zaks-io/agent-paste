import { resolveUsagePolicy } from "@agent-paste/config";
import { createMemoryWriteAllowanceNamespace } from "@agent-paste/write-allowance";
import { describe, expect, it } from "vitest";
import { enrichUsagePolicyWithWriteAllowance } from "./usage-policy-enrichment.js";

describe("enrichUsagePolicyWithWriteAllowance", () => {
  it("adds daily_new_artifacts_remaining when the binding is present", async () => {
    const policy = resolveUsagePolicy({ billingEnabled: false });
    const enriched = await enrichUsagePolicyWithWriteAllowance(policy, {
      workspaceId: "workspace-a",
      writeAllowance: createMemoryWriteAllowanceNamespace(),
    });

    expect(enriched.daily_new_artifacts_remaining).toBe(policy.daily_new_artifact_allowance);
  });

  it("returns the policy unchanged when the binding is absent", async () => {
    const policy = resolveUsagePolicy({ billingEnabled: false });
    await expect(
      enrichUsagePolicyWithWriteAllowance(policy, {
        workspaceId: "workspace-a",
      }),
    ).resolves.toEqual(policy);
  });
});
