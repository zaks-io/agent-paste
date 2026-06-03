import { describe, expect, it } from "vitest";
import { envPrefix, resolveSecretValue } from "./secret-values.mjs";

describe("secret-values", () => {
  it("maps targets to env prefixes", () => {
    expect(envPrefix("production")).toBe("PRODUCTION");
    expect(envPrefix("preview")).toBe("PREVIEW");
  });

  it("throws on an invalid environment instead of silently defaulting", () => {
    expect(() => envPrefix("local")).toThrow(/Invalid environment/);
    expect(() => envPrefix("prod")).toThrow(/Invalid environment/);
  });

  it("prefers the env-prefixed value, falling back to the bare name", () => {
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "production", { PRODUCTION_CONTENT_SIGNING_SECRET: "p" })).toBe(
      "p",
    );
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "production", { CONTENT_SIGNING_SECRET: "bare" })).toBe("bare");
    expect(
      resolveSecretValue("CONTENT_SIGNING_SECRET", "production", {
        PRODUCTION_CONTENT_SIGNING_SECRET: "p",
        CONTENT_SIGNING_SECRET: "bare",
      }),
    ).toBe("p");
  });

  it("does not read the wrong environment's prefix", () => {
    expect(
      resolveSecretValue("CONTENT_SIGNING_SECRET", "preview", {
        PRODUCTION_CONTENT_SIGNING_SECRET: "prod-only",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing is set", () => {
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "production", {})).toBeUndefined();
  });
});
