import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({
  captureException: () => {
    throw new Error("sentry unavailable");
  },
}));

const { logOp } = await import("./op-log.js");

describe("op-log sentry fallback", () => {
  it("uses plain-text fallback when structured logging and Sentry both fail", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("console unavailable");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logOp("cron.fallback", { ok: true })).not.toThrow();
    const calledFallback = [...logSpy.mock.calls, ...errorSpy.mock.calls].some((call) =>
      String(call[0]).includes("structured log failed"),
    );
    expect(calledFallback).toBe(true);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
