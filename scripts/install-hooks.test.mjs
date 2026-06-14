import { describe, expect, it, vi } from "vitest";
import { installHooks, shouldSkipInstall } from "./install-hooks.mjs";

describe("shouldSkipInstall", () => {
  it("installs in an unattended agent VM where only generic CI is set", () => {
    // Cursor/Codex background agents run non-interactively with CI=true but are
    // NOT GitHub Actions. They must still get the pre-push gate installed.
    expect(shouldSkipInstall({ CI: "true" })).toBe(false);
  });

  it("skips inside GitHub Actions", () => {
    expect(shouldSkipInstall({ GITHUB_ACTIONS: "true" })).toBe(true);
  });

  it("skips when an operator opts out with SKIP_LEFTHOOK", () => {
    expect(shouldSkipInstall({ SKIP_LEFTHOOK: "1" })).toBe(true);
  });

  it("installs on a normal developer machine", () => {
    expect(shouldSkipInstall({})).toBe(false);
  });
});

describe("installHooks", () => {
  function gitConfigMiss() {
    return { status: 1, stdout: "" };
  }

  it("does not shell out when install is skipped", () => {
    const spawn = vi.fn();
    const result = installHooks({ env: { GITHUB_ACTIONS: "true" }, spawn, log: () => {} });

    expect(result).toEqual({ installed: false, skipped: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("runs `lefthook install` when hooks should be installed", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce(gitConfigMiss()) // git config --get core.hooksPath
      .mockReturnValueOnce({ status: 0 }); // lefthook install

    const result = installHooks({ env: { CI: "true" }, spawn, log: () => {} });

    expect(result).toEqual({ installed: true, skipped: false });
    expect(spawn).toHaveBeenLastCalledWith("lefthook", ["install"], { stdio: "inherit" });
  });

  it("forces install when a custom core.hooksPath is configured", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: ".husky\n" }) // core.hooksPath set
      .mockReturnValueOnce({ status: 0 }); // lefthook install --force

    installHooks({ env: {}, spawn, log: () => {} });

    expect(spawn).toHaveBeenLastCalledWith("lefthook", ["install", "--force"], { stdio: "inherit" });
  });

  it("retries with --force and reports failure when install keeps failing", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce(gitConfigMiss()) // git config --get core.hooksPath
      .mockReturnValueOnce({ status: 1 }) // lefthook install
      .mockReturnValueOnce({ status: 1 }); // lefthook install --force
    const log = vi.fn();

    const result = installHooks({ env: {}, spawn, log });

    expect(result).toEqual({ installed: false, skipped: false, failed: true });
    expect(log).toHaveBeenCalledOnce();
  });
});
