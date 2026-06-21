import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { parseOpenRouterZdrEndpoints, validateConfiguredModels, validateConfiguredModelZdr } from "./openrouter";

describe("validateConfiguredModels", () => {
  it("treats provider routing as OpenRouter request routing, not a model parameter", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const model = {
      ...config.matrix.models[0],
      id: "moonshotai/kimi-k2.7-code",
      provider_params: {
        provider: { zdr: true, data_collection: "deny" },
        reasoning: { effort: "medium", exclude: true },
        unsupported: true,
      },
    };
    const warnings = validateConfiguredModels({ ...config, matrix: { ...config.matrix, models: [model] } }, [
      { id: model.id, supported_parameters: ["reasoning"] },
    ]);

    expect(warnings).toEqual([
      'moonshotai/kimi-k2.7-code does not list provider param "unsupported" in supported_parameters',
    ]);
  });
});

describe("validateConfiguredModelZdr", () => {
  it("fails enabled ZDR-required models missing from the ZDR endpoint list", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const model = {
      ...config.matrix.models[0],
      id: "moonshotai/kimi-k2.7-code",
      provider_params: { provider: { zdr: true, data_collection: "deny" } },
    };

    expect(() => validateConfiguredModelZdr({ ...config, matrix: { ...config.matrix, models: [model] } }, [])).toThrow(
      "openrouter_zdr_model_not_available:moonshotai/kimi-k2.7-code",
    );
  });

  it("ignores disabled ZDR-required models", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const model = {
      ...config.matrix.models[0],
      id: "qwen/qwen3.7-max",
      enabled: false,
      provider_params: { provider: { zdr: true, data_collection: "deny" } },
    };

    expect(validateConfiguredModelZdr({ ...config, matrix: { ...config.matrix, models: [model] } }, [])).toEqual([]);
  });

  it("warns on degraded ZDR endpoints but still allows the run", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const model = {
      ...config.matrix.models[0],
      id: "moonshotai/kimi-k2.7-code",
      provider_params: { provider: { zdr: true, data_collection: "deny" } },
    };

    expect(
      validateConfiguredModelZdr({ ...config, matrix: { ...config.matrix, models: [model] } }, [
        { model_id: "moonshotai/kimi-k2.7-code", provider_name: "Together", status: -2 },
      ]),
    ).toEqual(["moonshotai/kimi-k2.7-code has degraded ZDR endpoints: Together status=-2"]);
  });
});

describe("parseOpenRouterZdrEndpoints", () => {
  it("parses the current OpenRouter ZDR shape", () => {
    expect(
      parseOpenRouterZdrEndpoints({
        data: [
          {
            model_id: "moonshotai/kimi-k2.7-code",
            provider_name: "Together",
            tag: "together",
            status: 0,
          },
        ],
      }),
    ).toEqual([
      {
        model_id: "moonshotai/kimi-k2.7-code",
        provider_name: "Together",
        tag: "together",
        status: 0,
      },
    ]);
  });
});
