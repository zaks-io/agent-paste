import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";

describe("outbound trace propagation boundaries", () => {
  const targets = sentryOptions({}, "api").tracePropagationTargets ?? [];
  const propagates = (url: string) =>
    targets.some((target) => (typeof target === "string" ? url.includes(target) : target.test(url)));

  it.each([
    "https://api.agent-paste.sh/healthz",
    "https://upload.preview.agent-paste.sh/healthz",
    "https://agent-paste-api-pr-123.isaac-a46.workers.dev/healthz",
    "https://agent-paste.internal/v1/artifacts",
    "http://127.0.0.1:8787/healthz",
  ])("allows trusted destination %s", (url) => {
    expect(propagates(url)).toBe(true);
  });

  it.each([
    "https://external.test/healthz",
    "https://api.agent-paste.sh.external.test/healthz",
    "https://api.agent-paste.sh@external.test/healthz",
    "https://agent-paste-api-pr-123.someone-else.workers.dev/healthz",
    "https://01234-56789-abcde-fghjd.agent-paste.link/",
    "https://usercontent.agent-paste.sh/v/token/index.html",
  ])("excludes untrusted destination %s", (url) => {
    expect(propagates(url)).toBe(false);
  });
});
