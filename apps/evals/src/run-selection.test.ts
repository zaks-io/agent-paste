import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { selectMatrix } from "./run-selection";

describe("selectMatrix", () => {
  it("does not allow explicit selection of a disabled harness", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const disabledHarness = { ...config.matrix.harnesses[0], id: "disabled-pi", enabled: false };

    expect(() =>
      selectMatrix(
        {
          ...config,
          matrix: { ...config.matrix, harnesses: [...config.matrix.harnesses, disabledHarness] },
        },
        [],
        ["disabled-pi"],
      ),
    ).toThrow("harness_filter_disabled:disabled-pi");
  });
});
