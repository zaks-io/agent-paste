import { describe, expect, it } from "vitest";
import { shouldSkipRevisionQueueWork } from "./queue-target.js";

describe("shouldSkipRevisionQueueWork", () => {
  it("skips retained revisions", () => {
    expect(shouldSkipRevisionQueueWork({ revisionStatus: "retained", artifactStatus: "active" })).toBe(
      "revision_retained",
    );
  });

  it("skips when the parent artifact is deleted or expired", () => {
    expect(shouldSkipRevisionQueueWork({ revisionStatus: "published", artifactStatus: "deleted" })).toBe(
      "artifact_deleted",
    );
    expect(shouldSkipRevisionQueueWork({ revisionStatus: "published", artifactStatus: "expired" })).toBe(
      "artifact_deleted",
    );
  });

  it("skips bundle work when bundle status is terminal for generation", () => {
    expect(
      shouldSkipRevisionQueueWork({
        revisionStatus: "published",
        artifactStatus: "active",
        bundleStatus: "ready",
      }),
    ).toBe("bundle_ready");
    expect(
      shouldSkipRevisionQueueWork({
        revisionStatus: "published",
        artifactStatus: "active",
        bundleStatus: "disabled",
      }),
    ).toBe("bundle_disabled");
  });

  it("allows work for published active revisions with pending bundles", () => {
    expect(
      shouldSkipRevisionQueueWork({
        revisionStatus: "published",
        artifactStatus: "active",
        bundleStatus: "pending",
      }),
    ).toBeNull();
  });
});
