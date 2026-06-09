import { describe, expect, it } from "vitest";
import { extractPortInUseFromHarnessLog, formatPortInUseError, LOCAL_SERVER_PORT_ENV } from "./smoke-port.mjs";

describe("smoke-port", () => {
  it("formats port-in-use errors with env var override", () => {
    expect(formatPortInUseError(8787, "AGENT_PASTE_LOCAL_API_PORT", "api server")).toContain(
      "Port 8787 is already in use",
    );
    expect(formatPortInUseError(8787, "AGENT_PASTE_LOCAL_API_PORT", "api server")).toContain(
      "AGENT_PASTE_LOCAL_API_PORT",
    );
  });

  it("extracts new harness failure messages from logs", () => {
    const message =
      "Port 8789 is already in use (content server on 127.0.0.1:8789). Set AGENT_PASTE_LOCAL_CONTENT_PORT to a free port and retry.";
    const log = `agent-paste local harness failed: ${message}\n`;
    const error = extractPortInUseFromHarnessLog(log);
    expect(error?.message).toBe(message);
  });

  it("extracts legacy local server bind errors from logs", () => {
    const log =
      "agent-paste local content server failed on port 8789: listen EADDRINUSE: address already in use 127.0.0.1:8789\n";
    const error = extractPortInUseFromHarnessLog(log);
    expect(error?.message).toContain("8789");
    expect(error?.message).toContain(LOCAL_SERVER_PORT_ENV.content);
  });
});
