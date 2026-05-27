import { describe, expect, it } from "vitest";
import { BundleAvailability } from "./bundle.js";

describe("BundleAvailability", () => {
  it("requires ready fields and rejects pending-only hints", () => {
    expect(
      BundleAvailability.safeParse({
        status: "ready",
        url: "https://content.test/b/token",
        size_bytes: 10,
        generated_at: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      BundleAvailability.safeParse({
        status: "ready",
        url: "https://content.test/b/token",
        size_bytes: 10,
        generated_at: "2026-01-01T00:00:00.000Z",
        retry_after_seconds: 5,
      }).success,
    ).toBe(false);
  });

  it("requires retry_after_seconds only for pending", () => {
    expect(BundleAvailability.safeParse({ status: "pending", retry_after_seconds: 5 }).success).toBe(true);
    expect(BundleAvailability.safeParse({ status: "failed" }).success).toBe(true);
    expect(BundleAvailability.safeParse({ status: "disabled" }).success).toBe(true);
    expect(BundleAvailability.safeParse({ status: "failed", retry_after_seconds: 5 }).success).toBe(false);
  });
});
