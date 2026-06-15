import { describe, expect, it } from "vitest";
import {
  isExternalObservabilityBlockedPath,
  isExternalObservabilityBlockedRoute,
} from "../src/lib/external-observability";

describe("external observability route policy", () => {
  it("blocks Access Link viewer paths", () => {
    expect(isExternalObservabilityBlockedPath("/al/pub_123")).toBe(true);
    expect(isExternalObservabilityBlockedPath("/al/pub_123/")).toBe(true);
    expect(isExternalObservabilityBlockedPath("/access-links")).toBe(false);
    expect(isExternalObservabilityBlockedPath("/v/art_123")).toBe(false);
  });

  it("blocks Access Link route matches", () => {
    expect(isExternalObservabilityBlockedRoute([{ routeId: "__root__" }, { routeId: "/al/$publicId" }])).toBe(true);
    expect(isExternalObservabilityBlockedRoute([{ routeId: "__root__" }, { routeId: "/v/$artifactId" }])).toBe(false);
  });
});
