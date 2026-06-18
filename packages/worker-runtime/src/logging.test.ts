import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@sentry/cloudflare", () => sentry);

const { captureWorkerError, emitWorkerLog, pathFromUrl, sanitizeString, sanitizeWorkerLogAttributes } = await import(
  "./logging.js"
);

afterEach(() => {
  vi.restoreAllMocks();
  sentry.captureException.mockReset();
  sentry.logger.info.mockReset();
  sentry.logger.warn.mockReset();
  sentry.logger.error.mockReset();
  sentry.logger.fatal.mockReset();
});

describe("worker logging", () => {
  it("preserves structured console logs and sends Sentry logs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    emitWorkerLog({
      level: "warn",
      component: "api",
      event: "auth.reject",
      environment: "preview",
      request: new Request("https://api.test/v1/artifacts?token=secret#fragment", { method: "POST" }),
      requestId: "req_1",
      attributes: {
        safe: "ok",
        count: 2,
        private_url: "https://app.test/v/artifact?token=secret",
        authorization: "Bearer secret",
      },
    });

    const line = String(warnSpy.mock.calls[0]?.[0] ?? "");
    const body = JSON.parse(line) as Record<string, unknown>;
    expect(body).toMatchObject({
      level: "warn",
      component: "api",
      event: "auth.reject",
      environment: "preview",
      method: "POST",
      path: "/v1/artifacts",
      request_id: "req_1",
      safe: "ok",
      count: 2,
    });
    expect(body).not.toHaveProperty("private_url");
    expect(body).not.toHaveProperty("authorization");
    expect(sentry.logger.warn).toHaveBeenCalledWith("auth.reject", expect.objectContaining({ request_id: "req_1" }));
  });

  it("keeps info logs console-only", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitWorkerLog({
      level: "info",
      component: "jobs",
      event: "cron.retention",
      attributes: { discovered: 2 },
    });

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      level: "info",
      component: "jobs",
      event: "cron.retention",
      discovered: 2,
    });
    expect(sentry.logger.info).not.toHaveBeenCalled();
  });

  it("captures exceptions with sanitized attributes", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("failed https://api.test/v1/upload?token=secret with ap_pk_prod_secret");

    captureWorkerError({
      component: "upload",
      event: "upload.unhandled",
      error,
      request: new Request("https://upload.test/v1/upload?token=secret"),
      attributes: {
        body: { raw: true },
        workspace_id: "ignored_override",
        workspaceId: "ws_1",
      },
    });

    const line = String(errorSpy.mock.calls[0]?.[0] ?? "");
    const body = JSON.parse(line) as Record<string, unknown>;
    expect(body.error_message).toBe("failed [url:/v1/upload] with [redacted_api_key]");
    expect(body.path).toBe("/v1/upload");
    expect(body).not.toHaveProperty("body");
    expect(body.workspaceId).toBe("ws_1");
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      extra: expect.objectContaining({ error_message: "failed [url:/v1/upload] with [redacted_api_key]" }),
    });
    expect(sentry.logger.error).toHaveBeenCalledWith(
      "upload.unhandled",
      expect.objectContaining({ error_name: "Error" }),
    );
  });

  it("strips banned keys and non-scalar values", () => {
    expect(
      sanitizeWorkerLogAttributes({
        api_key: "ap_pk_prod_secret",
        token: "secret",
        access_link_blob: "signed",
        nested: { unsafe: true },
        safe: true,
        path: "/v/abc.def/index.html?token=secret",
        note: "fetch https://content.test/v/tok/index.html?expires=1",
      }),
    ).toEqual({
      note: "fetch [url:/v/[redacted_content_token]/index.html]",
      path: "/v/[redacted_content_token]/index.html",
      safe: true,
    });
  });

  it("redacts token-bearing path segments", () => {
    expect(pathFromUrl("https://content.test/v/payload.signature/index.html?expires=1")).toBe(
      "/v/[redacted_content_token]/index.html",
    );
    expect(pathFromUrl("https://content.test/b/payload.signature")).toBe("/b/[redacted_content_token]");
    expect(pathFromUrl("https://api.test/v1/public/agent-view/payload.signature")).toBe(
      "/v1/public/agent-view/[redacted_agent_view_token]",
    );
  });

  it("redacts JSON-style secret assignments before truncating", () => {
    const escapedSecret = sanitizeString('failed {"token":"abc\\"def","safe":"ok"}');
    expect(escapedSecret).toBe('failed {"token":"[redacted]","safe":"ok"}');

    const boundarySecret = sanitizeString(`${"x".repeat(2032)} "token":"secret_after_boundary"`);
    expect(boundarySecret).not.toContain("secret_after_boundary");
    expect(boundarySecret).not.toContain("secret_");
    expect(boundarySecret).toContain("[truncated]");
  });

  it("never throws if console and Sentry logging fail", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console unavailable");
    });
    sentry.logger.error.mockImplementation(() => {
      throw new Error("sentry unavailable");
    });

    expect(() =>
      emitWorkerLog({
        level: "error",
        component: "jobs",
        event: "queue.failed",
        attributes: { revision_id: "rev_1" },
      }),
    ).not.toThrow();
  });
});
