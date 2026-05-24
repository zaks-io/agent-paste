import { describe, expect, it } from "vitest";
import type { Clock } from "./clock.js";
import { isValidUploadPayload, mintUploadToken, mintUploadUrl, verifyUploadToken } from "./upload-url.js";

const fixedClock = (seconds: number): Clock => ({ now: () => seconds * 1000 });
const SECRET = "upload-secret";
const base = { sid: "us_1", path: "dir/file.txt", key: "ws_1/art_1/file.txt", size: 1024, exp: 2000 };

describe("isValidUploadPayload", () => {
  it("accepts a minimal payload", () => {
    expect(isValidUploadPayload(base)).toBe(true);
  });

  it.each([
    { label: "non-number size", value: { ...base, size: "big" } },
    { label: "empty sid", value: { ...base, sid: "" } },
    { label: "empty path", value: { ...base, path: "" } },
    { label: "non-integer exp", value: { ...base, exp: 1.5 } },
    { label: "null", value: null },
    { label: "array", value: [] },
  ])("rejects $label", ({ value }) => {
    expect(isValidUploadPayload(value)).toBe(false);
  });
});

describe("mint + verify", () => {
  it("round-trips a payload", async () => {
    const token = await mintUploadToken(base, SECRET);
    expect(await verifyUploadToken(token, SECRET, fixedClock(1000))).toEqual(base);
  });

  it("returns null for a garbage token without throwing", async () => {
    expect(await verifyUploadToken("garbage-token", SECRET, fixedClock(1000))).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await mintUploadToken({ ...base, exp: 1000 }, SECRET);
    expect(await verifyUploadToken(token, SECRET, fixedClock(1001))).toBeNull();
  });
});

describe("mintUploadUrl", () => {
  it("builds the signed PUT URL with encoded path and token query", async () => {
    const url = await mintUploadUrl({ baseUrl: "https://upload.example", secret: SECRET, payload: base });
    expect(url).toMatch(/^https:\/\/upload\.example\/v1\/upload-sessions\/us_1\/files\/dir\/file\.txt\?token=[^&]+$/);
  });
});
