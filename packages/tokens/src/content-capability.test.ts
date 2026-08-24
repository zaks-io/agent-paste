import { describe, expect, it } from "vitest";
import {
  contentCapabilityHostname,
  contentCapabilityIdFromHostname,
  contentCapabilityObjectKey,
  isContentCapabilityHostname,
  mintContentCapabilityId,
  parseContentCapabilityDomain,
  parseContentCapabilityManifest,
  serializeContentCapabilityManifest,
} from "./content-capability.js";

const capabilityId = "00112233445566778899aabbccddeeff";

describe("content capabilities", () => {
  it("encodes exactly 128 bits of random capability entropy", () => {
    expect(mintContentCapabilityId(Uint8Array.from({ length: 16 }, (_, index) => index))).toBe(
      "000102030405060708090a0b0c0d0e0f",
    );
    expect(() => mintContentCapabilityId(new Uint8Array(15))).toThrow(/exactly 16/);
  });

  it("builds versioned R2 manifest keys only for valid capability IDs", () => {
    expect(contentCapabilityObjectKey(capabilityId)).toBe(`content-capabilities/v1/${capabilityId}.json`);
    expect(() => contentCapabilityObjectKey("not-an-id")).toThrow(/Invalid/);
  });

  it("validates canonical capability domains and extracts one suffixed capability label", () => {
    expect(parseContentCapabilityDomain("content.example.test")).toBe("content.example.test");
    expect(contentCapabilityHostname(capabilityId, "content.example.test")).toBe(
      `${capabilityId}-uc.content.example.test`,
    );
    expect(contentCapabilityIdFromHostname(`${capabilityId}-uc.content.example.test`, "content.example.test")).toBe(
      capabilityId,
    );
    expect(
      contentCapabilityIdFromHostname(`prefix.${capabilityId}-uc.content.example.test`, "content.example.test"),
    ).toBeNull();
    expect(isContentCapabilityHostname("invalid-uc.content.example.test", "content.example.test")).toBe(true);
    expect(isContentCapabilityHostname("invalid.content.example.test", "content.example.test")).toBe(false);
    expect(isContentCapabilityHostname("content.example.test", "content.example.test")).toBe(false);
  });

  it.each([
    "https://content.example.test",
    "*.content.example.test",
    "Content.example.test",
    "content.example.test:443",
    "localhost",
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(29)}`,
  ])("rejects non-canonical capability domain %s", (domain) => {
    expect(() => parseContentCapabilityDomain(domain)).toThrow(/CONTENT_CAPABILITY_DOMAIN/);
  });

  it("keeps generated capability hostnames within the 253-character DNS limit", () => {
    const acceptedDomain = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(31)}`;
    const rejectedDomain = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(32)}`;

    expect(acceptedDomain).toHaveLength(217);
    expect(contentCapabilityHostname(capabilityId, acceptedDomain)).toHaveLength(253);
    expect(rejectedDomain).toHaveLength(218);
    expect(() => parseContentCapabilityDomain(rejectedDomain)).toThrow(/CONTENT_CAPABILITY_DOMAIN/);
  });

  it("round-trips strict versioned manifests", () => {
    const manifest = {
      version: 1 as const,
      signed_token: "payload.signature",
      entrypoint: "docs/index.html",
      revision_number: 2,
      artifact_updated_at: "2026-08-24T00:00:00.000Z",
    };
    expect(parseContentCapabilityManifest(serializeContentCapabilityManifest(manifest))).toEqual(manifest);
  });

  it.each([
    "not-json",
    "{}",
    '{"version":2,"signed_token":"token","entrypoint":"index.html"}',
    '{"version":1,"signed_token":"","entrypoint":"index.html"}',
    '{"version":1,"signed_token":"token","entrypoint":"/index.html"}',
  ])("rejects malformed manifests", (manifest) => {
    expect(parseContentCapabilityManifest(manifest)).toBeNull();
  });
});
