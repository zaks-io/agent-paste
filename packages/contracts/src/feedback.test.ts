import { describe, expect, it } from "vitest";
import { CreateFeedbackRequest, FeedbackContext } from "./feedback.js";

describe("feedback input bounds", () => {
  it("accepts bounded scalar metadata and trims the submitted body", () => {
    expect(
      CreateFeedbackRequest.parse({
        body: " useful feedback \n",
        context: { surface: "cli", version: "0.2.7", retry: false },
      }),
    ).toMatchObject({ body: "useful feedback" });
  });
  it.each([
    { body: " " },
    { body: "before\u0000after" },
    { body: "valid", context: { "key\u0000suffix": "value" } },
    { body: "valid", context: { key: "value\u0000suffix" } },
    { body: "x".repeat(10001) },
    { body: "valid", workspace_id: "foreign" },
    { body: "valid", context: { nested: { secret: "value" } } },
    { body: "valid", context: { long: "x".repeat(501) } },
    { body: "valid", context: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, index])) },
  ])("rejects invalid or oversized requests", (input) => {
    expect(CreateFeedbackRequest.safeParse(input).success).toBe(false);
  });
  it("bounds encoded UTF-8 bytes independently of character counts", () => {
    expect(
      FeedbackContext.safeParse(
        Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`field${index}`, "界".repeat(500)])),
      ).success,
    ).toBe(false);
  });
});
