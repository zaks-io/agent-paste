import { afterEach, describe, expect, it } from "vitest";
import { readCspNonce } from "../src/lib/csp-nonce-client";

describe("readCspNonce", () => {
  afterEach(() => {
    for (const node of document.head.querySelectorAll('meta[property="csp-nonce"]')) {
      node.remove();
    }
  });

  it("returns the nonce from the csp-nonce meta tag", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "csp-nonce");
    meta.content = "nonce-abc";
    document.head.appendChild(meta);

    expect(readCspNonce()).toBe("nonce-abc");
  });

  it("returns undefined when no meta tag is present", () => {
    expect(readCspNonce()).toBeUndefined();
  });

  it("returns undefined for an empty content attribute", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "csp-nonce");
    meta.content = "";
    document.head.appendChild(meta);

    expect(readCspNonce()).toBeUndefined();
  });
});
