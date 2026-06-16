import { describe, expect, it } from "vitest";
import {
  buildPageMeta,
  DEFAULT_DESCRIPTION,
  formatPageTitle,
  resolvePageUrl,
  webBaseUrlFromMatches,
} from "../src/lib/page-meta";

describe("formatPageTitle", () => {
  it("appends the site suffix", () => {
    expect(formatPageTitle("Dashboard")).toBe("Dashboard | agent-paste");
  });

  it("does not double-append the suffix", () => {
    expect(formatPageTitle("Dashboard | agent-paste")).toBe("Dashboard | agent-paste");
  });

  it("leaves the bare site name unchanged", () => {
    expect(formatPageTitle("agent-paste")).toBe("agent-paste");
  });
});

describe("resolvePageUrl", () => {
  it("joins a path with the configured web base URL", () => {
    expect(resolvePageUrl("https://app.agent-paste.sh", "/dashboard")).toBe("https://app.agent-paste.sh/dashboard");
  });

  it("returns absolute URLs unchanged", () => {
    expect(resolvePageUrl(undefined, "https://example.test/al/pub_1")).toBe("https://example.test/al/pub_1");
  });
});

describe("webBaseUrlFromMatches", () => {
  it("reads the root loader web base URL", () => {
    expect(
      webBaseUrlFromMatches([
        { routeId: "__root__", loaderData: { webBaseUrl: "https://app.preview.agent-paste.sh" } },
        { routeId: "/_authed/dashboard" },
      ]),
    ).toBe("https://app.preview.agent-paste.sh");
  });
});

describe("buildPageMeta", () => {
  it("builds dashboard title and description tags", () => {
    expect(
      buildPageMeta({
        title: "Dashboard",
        description: "Overview of recent artifacts.",
        path: "/dashboard",
        baseUrl: "https://app.agent-paste.sh",
      }),
    ).toEqual({
      meta: [{ title: "Dashboard | agent-paste" }, { name: "description", content: "Overview of recent artifacts." }],
    });
  });

  it("adds social tags for public pages", () => {
    const { meta } = buildPageMeta({
      title: "Sign in",
      description: "Sign in to agent-paste.",
      path: "/",
      baseUrl: "https://app.agent-paste.sh",
      social: true,
    });

    expect(meta).toEqual(
      expect.arrayContaining([
        { title: "Sign in | agent-paste" },
        { name: "description", content: "Sign in to agent-paste." },
        { property: "og:type", content: "website" },
        { property: "og:title", content: "Sign in | agent-paste" },
        { property: "og:description", content: "Sign in to agent-paste." },
        { property: "og:url", content: "https://app.agent-paste.sh/" },
        { property: "og:image", content: "https://app.agent-paste.sh/agent-paste-social.svg" },
        { property: "og:image:type", content: "image/svg+xml" },
        { property: "og:image:width", content: "1080" },
        { property: "og:image:height", content: "256" },
        { property: "og:image:alt", content: "agent-paste.sh" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: "https://app.agent-paste.sh/agent-paste-social.svg" },
        { name: "twitter:image:alt", content: "agent-paste.sh" },
        { name: "twitter:title", content: "Sign in | agent-paste" },
        { name: "twitter:description", content: "Sign in to agent-paste." },
      ]),
    );
  });

  it("uses the default description when omitted", () => {
    const { meta } = buildPageMeta({ title: "Artifacts" });
    expect(meta).toContainEqual({ name: "description", content: DEFAULT_DESCRIPTION });
  });

  it("supports noindex metadata", () => {
    const { meta } = buildPageMeta({
      title: "Access Link",
      noIndex: true,
      social: true,
      path: "/al/pub_1",
      baseUrl: "https://app.agent-paste.sh",
    });

    expect(meta).toContainEqual({ name: "robots", content: "noindex,nofollow" });
  });
});
