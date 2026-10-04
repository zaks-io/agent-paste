import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveSentryRelease } from "./deploy-release.mjs";

describe("deploy release", () => {
  it("uses the checked-out commit for every deploy environment", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(resolveSentryRelease({})).toBe(head);
    expect(resolveSentryRelease({ SENTRY_RELEASE: " " })).toBe(head);
  });

  it("preserves an explicit release name without interpreting it as a command", () => {
    expect(resolveSentryRelease({ SENTRY_RELEASE: " agent-paste@v1:build-2 " })).toBe("agent-paste@v1:build-2");
    expect(resolveSentryRelease({ SENTRY_RELEASE: "literal-$(command)-`command`" })).toBe(
      "literal-$(command)-`command`",
    );
  });

  it.each(["release\nname", "release\0name"])("rejects control characters", (release) => {
    expect(() => resolveSentryRelease({ SENTRY_RELEASE: release })).toThrow(/without control characters/);
  });
});
