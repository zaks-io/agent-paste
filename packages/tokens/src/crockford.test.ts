import { describe, expect, it } from "vitest";
import { decodeCrockfordPublicId } from "./crockford.js";

describe("decodeCrockfordPublicId", () => {
  it("decodes a valid 16-character public id to 10 bytes", () => {
    const bytes = decodeCrockfordPublicId("0123456789ABCDEF");
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBe(10);
  });

  it("rejects invalid lengths and characters", () => {
    expect(decodeCrockfordPublicId("short")).toBeNull();
    expect(decodeCrockfordPublicId("0123456789ABCDEI")).toBeNull();
    expect(decodeCrockfordPublicId("0123456789ABCDEFG")).toBeNull();
  });
});
