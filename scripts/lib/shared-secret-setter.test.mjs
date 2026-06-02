import { describe, expect, it } from "vitest";
import { VERSIONED_SECRET_PROFILES } from "./rotation-profiles.mjs";
import { appsForProfile } from "./shared-secret-setter.mjs";

describe("appsForProfile", () => {
  it("derives the content-signing Worker set from the rotation profile", () => {
    expect(appsForProfile("content-signing")).toEqual(["api", "upload", "content", "jobs"]);
  });

  it("derives the upload-signing Worker set from the rotation profile", () => {
    expect(appsForProfile("upload-signing")).toEqual(["upload"]);
  });

  it("derives the artifact-bytes-encryption Worker set from the rotation profile", () => {
    expect(appsForProfile("artifact-bytes-encryption")).toEqual(["upload", "content", "jobs"]);
  });

  it("matches the binding order declared in the rotation profile", () => {
    for (const [id, profile] of Object.entries(VERSIONED_SECRET_PROFILES)) {
      expect(appsForProfile(id)).toEqual(profile.bindings.map((binding) => binding.app));
    }
  });

  it("throws on an unknown profile id", () => {
    expect(() => appsForProfile("nope")).toThrow(/Unknown rotation profile/);
  });
});
