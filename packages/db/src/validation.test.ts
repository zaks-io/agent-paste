import { describe, expect, it } from "vitest";
import { RepositoryError } from "./repository-error.js";
import {
  bundleKeyFor,
  contentTypeForPath,
  normalizeStoragePath,
  objectKeyFor,
  storageEnvSegment,
  validateUpload,
} from "./validation.js";

const usagePolicy = {
  file_count_cap: 2,
  file_size_cap_bytes: 10,
  artifact_size_cap_bytes: 15,
};

describe("validateUpload", () => {
  it("rejects empty, oversized, and entrypoint-missing uploads", () => {
    expect(() => validateUpload([], usagePolicy)).toThrow(RepositoryError);
    expect(() =>
      validateUpload(
        [
          { path: "a.txt", size_bytes: 5 },
          { path: "b.txt", size_bytes: 5 },
          { path: "c.txt", size_bytes: 1 },
        ],
        usagePolicy,
      ),
    ).toThrow(RepositoryError);
    expect(() => validateUpload([{ path: "big.txt", size_bytes: 11 }], usagePolicy)).toThrow(RepositoryError);
    expect(() =>
      validateUpload(
        [
          { path: "a.txt", size_bytes: 8 },
          { path: "b.txt", size_bytes: 8 },
        ],
        usagePolicy,
      ),
    ).toThrow(RepositoryError);
    expect(() => validateUpload([{ path: "notes.txt", size_bytes: 3 }], usagePolicy, "index.html")).toThrow(
      RepositoryError,
    );
  });

  it("accepts uploads within caps that include the entrypoint", () => {
    expect(() =>
      validateUpload(
        [
          { path: "index.html", size_bytes: 5 },
          { path: "app.js", size_bytes: 4 },
        ],
        usagePolicy,
      ),
    ).not.toThrow();
  });
});

describe("normalizeStoragePath", () => {
  it("normalizes separators and rejects traversal", () => {
    expect(normalizeStoragePath("nested\\file.txt")).toBe("nested/file.txt");
    expect(() => normalizeStoragePath("../secret")).toThrow(RepositoryError);
    expect(() => normalizeStoragePath("/absolute")).toThrow(RepositoryError);
  });
});

describe("objectKeyFor and contentTypeForPath", () => {
  it("builds deterministic object keys and served MIME types", () => {
    expect(objectKeyFor("art_1", "rev_1", "index.html")).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
    expect(contentTypeForPath("notes.md")).toBe("text/markdown; charset=utf-8");
  });
});

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
