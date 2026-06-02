import { describe, expect, it } from "vitest";
import { RepositoryError, repositoryErrorToAppError } from "./repository-error.js";

describe("repositoryErrorToAppError", () => {
  it("maps repository failures to contract error codes", () => {
    expect(repositoryErrorToAppError(new RepositoryError("artifact_not_found"))).toBe("artifact_not_found");
    expect(repositoryErrorToAppError(new RepositoryError("invalid_ttl_seconds"))).toBe("invalid_request");
    expect(repositoryErrorToAppError(new RepositoryError("access_link_lockdown_active"))).toBe("not_found");
    expect(repositoryErrorToAppError(new RepositoryError("current_api_key_not_found"))).toBe("not_authenticated");
  });

  it("returns null for non-repository and unmapped failures", () => {
    expect(repositoryErrorToAppError(new Error("artifact_not_found"))).toBeNull();
    expect(repositoryErrorToAppError(new RepositoryError("lockdown_insert_conflict"))).toBeNull();
    expect(repositoryErrorToAppError(null)).toBeNull();
  });
});
