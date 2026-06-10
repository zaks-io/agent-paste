import { describe, expect, it } from "vitest";
import type { Clock } from "./clock.js";
import { isValidContentTokenPayload, mintContentToken, mintContentUrl, verifyContentToken } from "./content.js";

const fixedClock = (seconds: number): Clock => ({ now: () => seconds * 1000 });
const SECRET = "content-secret";
const base = { artifact_id: "art_1", revision_id: "rev_1", exp: 2000 };

describe("isValidContentTokenPayload", () => {
  it("accepts a minimal payload", () => {
    expect(isValidContentTokenPayload(base)).toBe(true);
  });

  it("accepts optional workspace_id, access_link_id, key_prefix, paths, object keys, noindex, and script_disabled", () => {
    expect(
      isValidContentTokenPayload({
        ...base,
        workspace_id: "ws_1",
        access_link_id: "al_1",
        key_prefix: "art_1/rev_1",
        object_key: "workspaces/ws_1/blobs/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        object_keys: {
          "index.html":
            "workspaces/ws_1/blobs/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        paths: ["index.html", "style.css"],
        noindex: true,
        script_disabled: true,
      }),
    ).toBe(true);
  });

  it.each([
    { label: "bad artifact_id prefix", value: { ...base, artifact_id: "x_1" } },
    { label: "non-string revision_id", value: { ...base, revision_id: 5 } },
    { label: "bad access_link_id prefix", value: { ...base, access_link_id: "nope" } },
    { label: "non-string path entry", value: { ...base, paths: [1] } },
    { label: "non-string object key map value", value: { ...base, object_keys: { "index.html": 1 } } },
    { label: "non-integer exp", value: { ...base, exp: 1.5 } },
    { label: "null", value: null },
    { label: "array", value: [] },
  ])("rejects $label", ({ value }) => {
    expect(isValidContentTokenPayload(value)).toBe(false);
  });
});

describe("mint + verify", () => {
  it("round-trips a payload with workspace_id and paths", async () => {
    const payload = { ...base, workspace_id: "ws_1", paths: ["index.html"] };
    const token = await mintContentToken(payload, SECRET);
    expect(await verifyContentToken(token, SECRET, fixedClock(1000))).toEqual(payload);
  });

  it("rejects an expired token", async () => {
    const token = await mintContentToken({ ...base, exp: 1000 }, SECRET);
    expect(await verifyContentToken(token, SECRET, fixedClock(1001))).toBeNull();
  });
});

describe("mintContentUrl", () => {
  it("builds {baseUrl}/v/{token}/{encoded path}", async () => {
    const url = await mintContentUrl({
      baseUrl: "https://usercontent.example",
      secret: SECRET,
      payload: base,
      path: "a b/index.html",
    });
    expect(url).toMatch(/^https:\/\/usercontent\.example\/v\/[^/]+\/a%20b\/index\.html$/);
  });
});
