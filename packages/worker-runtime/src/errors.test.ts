import { RepositoryError } from "@agent-paste/db";
import { describe, expect, it } from "vitest";
import { unknownErrorToCode } from "./errors.js";

describe("unknownErrorToCode", () => {
  it("maps repository errors before legacy message codes", () => {
    expect(unknownErrorToCode(new RepositoryError("invalid_cursor"))).toBe("invalid_cursor");
    expect(unknownErrorToCode(new RepositoryError("current_api_key_not_found"))).toBe("not_authenticated");
  });

  it("still maps legacy error.message contract codes", () => {
    expect(unknownErrorToCode(new Error("forbidden"))).toBe("forbidden");
    expect(unknownErrorToCode(new Error("not a code"))).toBeNull();
  });
});
