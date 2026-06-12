import { AgentPasteError, CLIENT_AUTH_HANDOFF_HINT } from "@agent-paste/api-client";
import { describe, expect, it } from "vitest";
import {
  createProgress,
  EXIT_AUTH,
  EXIT_GENERIC,
  EXIT_NETWORK,
  EXIT_NOT_FOUND,
  EXIT_QUOTA,
  EXIT_VALIDATION,
  exitCodeFor,
  formatBytes,
  formatError,
  hyperlink,
  paint,
  resolveMode,
} from "../src/render.js";

const TTY = { isTTY: true, NO_COLOR: undefined, CI: undefined, TERM: "xterm" };

describe("resolveMode", () => {
  it("returns json whenever --json is set, regardless of tty/color", () => {
    expect(resolveMode({ json: true, color: true, env: TTY })).toBe("json");
    expect(resolveMode({ json: true, color: false, env: { isTTY: false } })).toBe("json");
  });

  it("is rich on a tty and plain off one", () => {
    expect(resolveMode({ json: false, env: TTY })).toBe("rich");
    expect(resolveMode({ json: false, env: { isTTY: false } })).toBe("plain");
  });

  it("honors NO_COLOR, CI, and TERM=dumb by forcing plain", () => {
    expect(resolveMode({ json: false, env: { ...TTY, NO_COLOR: "1" } })).toBe("plain");
    expect(resolveMode({ json: false, env: { ...TTY, CI: "true" } })).toBe("plain");
    expect(resolveMode({ json: false, env: { ...TTY, TERM: "dumb" } })).toBe("plain");
  });

  it("lets explicit --color / --no-color override detection", () => {
    expect(resolveMode({ json: false, color: true, env: { isTTY: false } })).toBe("rich");
    expect(resolveMode({ json: false, color: false, env: TTY })).toBe("plain");
  });
});

describe("paint and hyperlink", () => {
  it("wraps in ansi only in rich mode", () => {
    expect(paint("rich", "green", "x")).toContain("\x1b[32m");
    expect(paint("plain", "green", "x")).toBe("x");
    expect(paint("json", "green", "x")).toBe("x");
  });

  it("emits an osc-8 link in rich mode and a bare url otherwise", () => {
    const url = "https://example.test/a";
    expect(hyperlink("rich", url)).toContain("\x1b]8;;");
    expect(hyperlink("rich", url)).toContain(url);
    expect(hyperlink("plain", url)).toBe(url);
  });
});

describe("formatBytes", () => {
  it("renders human units and stays exact under 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
  });
});

describe("createProgress", () => {
  it("repaints in rich mode and clears on done", () => {
    const chunks: string[] = [];
    const progress = createProgress("rich", { write: (c) => chunks.push(c) });
    progress.update({ done: 1, total: 3, bytes: 100 });
    progress.update({ done: 2, total: 3, bytes: 200 });
    progress.done();
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toContain("1/3");
    expect(chunks[2]).toContain("\r");
  });

  it("is a no-op in plain and json modes (never corrupts a pipe)", () => {
    for (const mode of ["plain", "json"] as const) {
      const chunks: string[] = [];
      const progress = createProgress(mode, { write: (c) => chunks.push(c) });
      progress.update({ done: 1, total: 2, bytes: 1 });
      progress.done();
      expect(chunks).toEqual([]);
    }
  });
});

describe("exitCodeFor", () => {
  const err = (input: { code: string; status: number }) =>
    new AgentPasteError({ code: input.code, message: input.code, status: input.status });

  // Real contract codes and their statuses (packages/contracts/src/mcp/error-codes.ts)
  // so the test guards the actual quota/auth paths, not fictional inputs.
  it("maps the 429 quota/rate-limit family to EXIT_QUOTA", () => {
    expect(exitCodeFor(err({ code: "write_allowance_exceeded", status: 429 }))).toBe(EXIT_QUOTA);
    expect(exitCodeFor(err({ code: "usage_policy_exceeded", status: 429 }))).toBe(EXIT_QUOTA);
    expect(exitCodeFor(err({ code: "rate_limited_actor", status: 429 }))).toBe(EXIT_QUOTA);
    expect(exitCodeFor(err({ code: "revision_ceiling_exceeded", status: 429 }))).toBe(EXIT_QUOTA);
  });

  it("buckets the rest by http status", () => {
    expect(exitCodeFor(err({ code: "not_authenticated", status: 401 }))).toBe(EXIT_AUTH);
    expect(exitCodeFor(err({ code: "http_error", status: 403 }))).toBe(EXIT_AUTH);
    expect(exitCodeFor(err({ code: "http_error", status: 404 }))).toBe(EXIT_NOT_FOUND);
    expect(exitCodeFor(err({ code: "http_error", status: 422 }))).toBe(EXIT_VALIDATION);
    expect(exitCodeFor(err({ code: "http_error", status: 500 }))).toBe(EXIT_NETWORK);
  });

  it("falls back to generic for non-AgentPasteError", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(EXIT_GENERIC);
  });
});

describe("formatError", () => {
  it("emits a json error envelope in json mode and a marker line otherwise", () => {
    const error = new AgentPasteError({
      code: "write_allowance_exceeded",
      message: "limit hit",
      status: 429,
      docs: "https://docs.test/quota",
    });
    const json = JSON.parse(formatError("json", error).trim());
    expect(json.error.code).toBe("write_allowance_exceeded");
    expect(json.error.docs).toBe("https://docs.test/quota");

    const human = formatError("plain", error);
    expect(human).toContain("write_allowance_exceeded");
    expect(human).toContain("limit hit");
    expect(human).toContain("https://docs.test/quota");
  });

  it("rewrites the client auth handoff hint for the install channel", () => {
    const error = new AgentPasteError({
      code: "not_authenticated",
      message: CLIENT_AUTH_HANDOFF_HINT,
      status: 401,
    });
    const previousUserAgent = process.env.npm_config_user_agent;
    process.env.npm_config_user_agent = "npm/10 npx/10";
    try {
      const human = formatError("plain", error);
      expect(human).toContain("npx @zaks-io/agent-paste login");
      expect(human).not.toContain("Run agent-paste login");

      const json = JSON.parse(formatError("json", error).trim());
      expect(json.error.message).toContain("npx @zaks-io/agent-paste login");
    } finally {
      if (previousUserAgent === undefined) delete process.env.npm_config_user_agent;
      else process.env.npm_config_user_agent = previousUserAgent;
    }
  });
});
