import { afterEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
const captureException = vi.fn(() => {
  throw new Error("sentry unavailable");
});
const loggerInfo = vi.fn();
const loggerError = vi.fn();

vi.mock("@sentry/cloudflare", () => ({
  captureMessage,
  captureException,
  logger: {
    info: loggerInfo,
    warn: vi.fn(),
    error: loggerError,
    fatal: vi.fn(),
  },
}));

const { logOp, logOpError } = await import("./op-log.js");

afterEach(() => {
  vi.restoreAllMocks();
  captureMessage.mockReset();
  captureException.mockReset();
  loggerInfo.mockReset();
  loggerError.mockReset();
});

describe("op-log sentry forwarding", () => {
  it("forwards error-level logs to Sentry", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logOpError("queue.failed", { revision_id: "rev_test" });
    expect(loggerError).toHaveBeenCalledWith("queue.failed", expect.objectContaining({ revision_id: "rev_test" }));
    expect(captureMessage).not.toHaveBeenCalled();
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

  it("keeps info-level operation logs out of Sentry", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logOp("cron.fallback", { ok: true });

    expect(loggerInfo).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      level: "info",
      component: "jobs",
      event: "cron.fallback",
      ok: true,
    });
  });
});
