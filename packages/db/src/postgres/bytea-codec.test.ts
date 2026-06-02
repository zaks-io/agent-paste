import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { byteaFromDriver, byteaToDriver } from "./bytea-codec.js";

describe("bytea codec", () => {
  const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  it("round-trips hex driver strings on write", () => {
    expect(byteaFromDriver(byteaToDriver(bytes))).toEqual(bytes);
    expect(byteaFromDriver("\\xdeadbeef")).toEqual(bytes);
  });

  it("decodes postgres-js Buffer-shaped driver values on read", () => {
    const buffer = Buffer.from(bytes);
    expect(byteaFromDriver(buffer)).toEqual(bytes);
    expect(byteaFromDriver(new Uint8Array(bytes))).toEqual(bytes);
  });

  it("rejects unsupported driver shapes", () => {
    expect(() => byteaFromDriver(42)).toThrow("bytea_from_driver_unsupported");
  });
});
