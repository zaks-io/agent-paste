import { afterEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
const captureException = vi.fn(() => {
  throw new Error("sentry unavailable");
});

vi.mock("@sentry/cloudflare", () => ({
  captureMessage,
  captureException,
}));

const { logOp, logOpError } = await import("./op-log.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("op-log sentry forwarding", () => {
  it("forwards error-level logs to Sentry", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logOpError("queue.failed", { revision_id: "rev_test" });
    expect(captureMessage).toHaveBeenCalledWith(
      "queue.failed",
      expect.objectContaining({ level: "error" }),
    );
    errorSpy.mockRestore();
  });

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
