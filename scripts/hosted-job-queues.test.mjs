import { describe, expect, it } from "vitest";
import { hostedJobQueues } from "./hosted-job-queues.mjs";

describe("hostedJobQueues", () => {
  it("returns preview queue names with DLQs before primary queues", () => {
    const queues = hostedJobQueues("preview");
    expect(queues.bundleGenerate).toBe("bundle-generate-preview");
    expect(queues.bundleGenerateDlq).toBe("bundle-generate-dlq-preview");
    expect(queues.creationOrder.indexOf(queues.bundleGenerateDlq)).toBeLessThan(
      queues.creationOrder.indexOf(queues.bundleGenerate),
    );
    expect(queues.creationOrder).toEqual([
      "byte-purge-dlq-preview",
      "safety-scan-dlq-preview",
      "bundle-generate-dlq-preview",
      "byte-purge-preview",
      "safety-scan-preview",
      "bundle-generate-preview",
    ]);
  });

  it("returns production queue names", () => {
    const queues = hostedJobQueues("production");
    expect(queues.bundleGenerate).toBe("bundle-generate-production");
    expect(queues.creationOrder.at(-1)).toBe("bundle-generate-production");
  });

  it("rejects unknown environments", () => {
    expect(() => hostedJobQueues("dev")).toThrow(/Unsupported hosted environment/);
  });
});
