import { describe, expect, it } from "vitest";
import { resolveSecretValue } from "./secret-values.mjs";

describe("secret-values", () => {
  it("throws on an invalid environment instead of silently defaulting", () => {
    expect(() => resolveSecretValue("CONTENT_SIGNING_SECRET", "local", {})).toThrow(/Invalid environment/);
    expect(() => resolveSecretValue("CONTENT_SIGNING_SECRET", "prod", {})).toThrow(/Invalid environment/);
  });

  it("reads the canonical Worker binding name", () => {
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "production", { CONTENT_SIGNING_SECRET: "bare" })).toBe("bare");
  });

  it("does not accept an environment-prefixed alias", () => {
    expect(
      resolveSecretValue("CONTENT_SIGNING_SECRET", "preview", {
        PRODUCTION_CONTENT_SIGNING_SECRET: "prod-only",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing is set", () => {
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "production", {})).toBeUndefined();
  });

  it("treats an empty or whitespace-only canonical value as unset", () => {
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "preview", { CONTENT_SIGNING_SECRET: "" })).toBeUndefined();
    expect(resolveSecretValue("CONTENT_SIGNING_SECRET", "preview", { CONTENT_SIGNING_SECRET: "   " })).toBeUndefined();
  });
});
