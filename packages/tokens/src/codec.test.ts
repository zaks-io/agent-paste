import { describe, expect, it } from "vitest";
import type { Clock } from "./clock.js";
import { sign, verify } from "./codec.js";
import { base64UrlEncode, hmac } from "./crypto.js";

type Demo = { id: string; exp: number };

function isDemo(value: unknown): value is Demo {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Demo).id === "string" &&
    typeof (value as Demo).exp === "number"
  );
}

const fixedClock = (seconds: number): Clock => ({ now: () => seconds * 1000 });
const SECRET = "codec-secret";

describe("sign / verify round-trip", () => {
  it("returns the payload when signature, shape, and expiry all hold", async () => {
    const token = await sign({ id: "demo", exp: 2000 }, SECRET);
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toEqual({
      id: "demo",
      exp: 2000,
    });
  });
});

describe("verify returns null instead of throwing", () => {
  it("rejects a tampered signature", async () => {
    const token = await sign({ id: "demo", exp: 2000 }, SECRET);
    const tampered = `${token.split(".")[0]}.deadbeef`;
    expect(await verify(tampered, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await sign({ id: "demo", exp: 2000 }, "other-secret");
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });

  it.each(["", "noseparator", "a.b.c", "%%%.%%%"])("rejects malformed token %j", async (token) => {
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });

  it("rejects an otherwise valid token with extra segments", async () => {
    const token = await sign({ id: "demo", exp: 2000 }, SECRET);
    expect(await verify(`${token}.extra`, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });

  it("returns null for a correctly signed payload that is not JSON", async () => {
    const encodedPayload = base64UrlEncode(new TextEncoder().encode("not json"));
    const token = `${encodedPayload}.${await hmac(encodedPayload, SECRET)}`;
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });

  it("rejects a payload that fails the shape guard", async () => {
    const token = await sign({ wrong: "shape", exp: 2000 }, SECRET);
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).toBeNull();
  });
});

describe("expiration is compared in whole seconds against the injected clock", () => {
  it("accepts a token whose exp equals the current second", async () => {
    const token = await sign({ id: "demo", exp: 1000 }, SECRET);
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1000) })).not.toBeNull();
  });

  it("rejects a token one second past exp", async () => {
    const token = await sign({ id: "demo", exp: 1000 }, SECRET);
    expect(await verify(token, SECRET, { isValid: isDemo, clock: fixedClock(1001) })).toBeNull();
  });
});
