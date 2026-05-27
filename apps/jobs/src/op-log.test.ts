import { describe, expect, it, vi } from "vitest";
import { logOp, logOpError } from "./op-log.js";

describe("op-log", () => {
  it("does not let caller fields override fixed metadata", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logOp("cron.test", { event: "override", level: "warn", component: "other", at: "bad", ok: true });
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.event).toBe("cron.test");
    expect(payload.level).toBe("info");
    expect(payload.component).toBe("jobs");
    expect(payload.ok).toBe(true);
    logSpy.mockRestore();
  });

  it("does not throw when JSON serialization fails", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logOpError("cron.broken", circular)).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
