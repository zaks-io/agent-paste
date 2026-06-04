import { ErrorCode } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { RepositoryError, RepositoryErrorCode, repositoryErrorToAppError } from "./repository-error.js";

describe("repositoryErrorToAppError", () => {
  it("maps repository failures to contract error codes", () => {
    expect(repositoryErrorToAppError(new RepositoryError("artifact_not_found"))).toBe("artifact_not_found");
    expect(repositoryErrorToAppError(new RepositoryError("invalid_auto_deletion_days"))).toBe("invalid_request");
    expect(repositoryErrorToAppError(new RepositoryError("access_link_lockdown_active"))).toBe("not_found");
    expect(repositoryErrorToAppError(new RepositoryError("current_api_key_not_found"))).toBe("not_authenticated");
  });

  it("returns null for non-repository errors", () => {
    expect(repositoryErrorToAppError(new Error("artifact_not_found"))).toBeNull();
    expect(repositoryErrorToAppError(null)).toBeNull();
  });

  it("maps every repository error kind to a contract code or explicit internal_error sentinel", () => {
    for (const kind of Object.values(RepositoryErrorCode)) {
      const mapped = repositoryErrorToAppError(new RepositoryError(kind));
      if (mapped === null) {
        continue;
      }
      expect(ErrorCode.options).toContain(mapped);
    }
  });

  it("maps infrastructure failures to internal_error via null", () => {
    expect(repositoryErrorToAppError(new RepositoryError("lockdown_insert_conflict"))).toBeNull();
    expect(repositoryErrorToAppError(new RepositoryError("unexpected_actor_type"))).toBeNull();
    expect(repositoryErrorToAppError(new RepositoryError("workspace_not_found"))).toBeNull();
  });
});
