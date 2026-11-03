import { describe, expect, it } from "vitest";
import { isValidContentTokenPayload, mintContentToken, verifyContentToken } from "./content.js";

const payload = {
  artifact_id: "art_test",
  revision_id: "rev_test",
  workspace_id: "ws_test",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
describe("original-byte content grants", () => {
  it("accepts legacy tokens and a literal true signed intent only", async () => {
    expect(isValidContentTokenPayload(payload)).toBe(true);
    for (const value of [false, null, 1, "true", {}])
      expect(isValidContentTokenPayload({ ...payload, original_bytes: value })).toBe(false);
    const token = await mintContentToken({ ...payload, original_bytes: true }, "secret");
    expect(await verifyContentToken(token, "secret")).toMatchObject({ original_bytes: true });
    const [body, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    delete changed.original_bytes;
    const tampered = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
    expect(await verifyContentToken(tampered, "secret")).toBeNull();
  });
});
