import { describe, expect, it } from "vitest";
import { bundleKeyFor, storageEnvSegment } from "./validation.js";

describe("storage keys", () => {
  it("maps agent paste env to the ADR 0021 env segment", () => {
    expect(storageEnvSegment("production")).toBe("live");
    expect(storageEnvSegment("live")).toBe("live");
    expect(storageEnvSegment("preview")).toBe("preview");
    expect(storageEnvSegment("dev")).toBe("dev");
    expect(storageEnvSegment(undefined)).toBe("dev");
  });

  it("builds deterministic bundle keys under env/workspaces", () => {
    expect(
      bundleKeyFor({
        workspaceId: "00000000-0000-4000-8000-000000000000",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        storageEnv: "live",
      }),
    ).toBe(
      "env/live/workspaces/00000000-0000-4000-8000-000000000000/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/bundle.zip",
    );
    expect(
      bundleKeyFor({
        workspaceId: "00000000-0000-4000-8000-000000000000",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        storageEnv: "production",
      }),
    ).toMatch(/^env\/live\/workspaces\//);
  });
});
