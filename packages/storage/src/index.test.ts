import { describe, expect, it } from "vitest";
import {
  BASE_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_HEADERS,
  contentTypeForPath,
  deriveScriptDisabledContentSecurityPolicy,
  SCRIPT_DISABLED_CONTENT_SECURITY_POLICY,
  servedContentForPath,
  withFrameAncestors,
  withScriptSrcNonce,
} from "./index";

function parseContentSecurityPolicyDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const segment of csp.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const spaceIndex = trimmed.search(/\s/u);
    if (spaceIndex === -1) {
      directives.set(trimmed, "");
      continue;
    }
    directives.set(trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1).trim());
  }
  return directives;
}

describe("storage helpers", () => {
  it("maps known extensions to MIME types", () => {
    expect(contentTypeForPath("docs/readme.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeForPath("index.htm")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("assets/app.js")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForPath("assets/module.mjs")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForPath("favicon.ico")).toBe("image/x-icon");
    expect(contentTypeForPath("image.PNG")).toBe("image/png");
    expect(contentTypeForPath("logs/build.LOG")).toBe("text/plain; charset=utf-8");
    expect(contentTypeForPath("fonts/inter.woff")).toBe("font/woff");
    expect(contentTypeForPath("fonts/inter.woff2")).toBe("font/woff2");
    expect(contentTypeForPath("paper.pdf")).toBe("application/pdf");
    expect(contentTypeForPath("audio/clip.mp3")).toBe("audio/mpeg");
    expect(contentTypeForPath("audio/clip.wav")).toBe("audio/wav");
    expect(contentTypeForPath("video/demo.mp4")).toBe("video/mp4");
    expect(contentTypeForPath("video/demo.webm")).toBe("video/webm");
    expect(contentTypeForPath("archive.bin")).toBe("application/octet-stream");
  });

  it("serves defensive content metadata for known and unknown extensions", () => {
    expect(servedContentForPath("app.js")).toMatchObject({
      contentType: "application/javascript; charset=utf-8",
      disposition: "inline",
      csp: BASE_CONTENT_SECURITY_POLICY,
    });
    expect(servedContentForPath("payload.bin")).toMatchObject({
      contentType: "application/octet-stream",
      disposition: "attachment",
      csp: BASE_CONTENT_SECURITY_POLICY,
    });
    expect(CONTENT_SECURITY_HEADERS["Content-Security-Policy"]).toBe(BASE_CONTENT_SECURITY_POLICY);
  });

  it("forces PDFs to download but keeps audio/video inline", () => {
    expect(servedContentForPath("paper.pdf")).toMatchObject({
      contentType: "application/pdf",
      disposition: "attachment",
    });
    for (const path of ["clip.mp3", "clip.wav", "demo.mp4", "demo.webm"]) {
      expect(servedContentForPath(path).disposition).toBe("inline");
    }
  });

  it("derives script-disabled CSP from base by transforming only script-src", () => {
    expect(SCRIPT_DISABLED_CONTENT_SECURITY_POLICY).toBe(
      deriveScriptDisabledContentSecurityPolicy(BASE_CONTENT_SECURITY_POLICY),
    );

    const baseDirectives = parseContentSecurityPolicyDirectives(BASE_CONTENT_SECURITY_POLICY);
    const disabledDirectives = parseContentSecurityPolicyDirectives(SCRIPT_DISABLED_CONTENT_SECURITY_POLICY);

    expect(baseDirectives.get("script-src")).toContain("https://cdn.tailwindcss.com");
    expect([...disabledDirectives.keys()]).toEqual([...baseDirectives.keys()]);
    for (const [name, value] of baseDirectives) {
      if (name === "script-src") {
        expect(disabledDirectives.get(name)).toBe("'none'");
        expect(value).toContain("'unsafe-inline'");
        expect(value).toContain("'unsafe-eval'");
      } else {
        expect(disabledDirectives.get(name)).toBe(value);
      }
    }
  });

  it("uses the script-disabled policy when requested", () => {
    expect(servedContentForPath("index.html", { scriptDisabled: true }).csp).toBe(
      SCRIPT_DISABLED_CONTENT_SECURITY_POLICY,
    );
    expect(servedContentForPath("index.html", { scriptDisabled: false }).csp).toBe(BASE_CONTENT_SECURITY_POLICY);
    expect(servedContentForPath("chart.svg", { scriptDisabled: true }).csp).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
  });
});

describe("withFrameAncestors", () => {
  it("replaces frame-ancestors 'none' with the given origins, preserving order", () => {
    const result = withFrameAncestors(BASE_CONTENT_SECURITY_POLICY, [
      "https://app.agent-paste.sh",
      "https://app.preview.agent-paste.sh",
    ]);
    expect(result).toContain("frame-ancestors https://app.agent-paste.sh https://app.preview.agent-paste.sh");
    expect(result).not.toContain("frame-ancestors 'none'");
    // Every other directive is untouched and the order is stable.
    expect(result.replace(/frame-ancestors[^;]*/u, "frame-ancestors 'none'")).toBe(BASE_CONTENT_SECURITY_POLICY);
  });

  it("restores 'none' for an empty origin list", () => {
    expect(withFrameAncestors(BASE_CONTENT_SECURITY_POLICY, [])).toBe(BASE_CONTENT_SECURITY_POLICY);
  });

  it("adds a frame-ancestors directive when the source policy omits it", () => {
    const result = withFrameAncestors("default-src 'none'; img-src data:", ["https://app.agent-paste.sh"]);
    expect(result).toBe("default-src 'none'; img-src data:; frame-ancestors https://app.agent-paste.sh");
  });
});

describe("withScriptSrcNonce", () => {
  it("replaces script-src with a single nonce source", () => {
    const result = withScriptSrcNonce(SCRIPT_DISABLED_CONTENT_SECURITY_POLICY, "deadbeef");
    expect(result).toContain("script-src 'nonce-deadbeef'");
    expect(result).not.toContain("script-src 'none'");
    expect(result).toContain("style-src 'self' 'unsafe-inline'");
  });
});
