import type { UsagePolicy } from "@agent-paste/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsagePolicyCard } from "../src/components/dashboard/UsagePolicyCard";

const policy: UsagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  bundle_size_cap_bytes: 25 * 1024 * 1024,
  bundles_enabled: true,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86400,
  default_ttl_seconds: 30 * 86400,
  min_ttl_seconds: 86400,
  max_ttl_seconds: 90 * 86400,
  live_artifacts_cap: 50,
  live_update_enabled: false,
  daily_new_artifact_allowance: 100,
  lifetime_revision_ceiling: 100,
};

describe("UsagePolicyCard", () => {
  it("formats caps and the default retention window", () => {
    render(<UsagePolicyCard policy={policy} />);
    expect(screen.getByText("10.0 MB")).toBeInTheDocument();
    expect(screen.getByText("60/min")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });
});
