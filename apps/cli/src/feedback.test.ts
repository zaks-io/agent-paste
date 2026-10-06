import { AgentPasteError, ApiClient } from "@agent-paste/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedback } from "./feedback.js";
import { main, parseArgs, SCHEMA_VERSION } from "./index.js";
import { exitCodeFor, formatError } from "./render.js";
import { CLI_VERSION } from "./version.js";

vi.mock("./update-check.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runUpdateCheck: vi.fn(),
}));

const feedbackId = "fb_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
afterEach(() => {
  vi.restoreAllMocks();
  if (stdinTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
  else delete process.stdin.isTTY;
});

function mockStdin(chunks: Uint8Array[]) {
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  vi.spyOn(process.stdin, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "data")
      queueMicrotask(() => {
        for (const chunk of chunks) listener(chunk);
      });
    if (event === "end") queueMicrotask(() => listener());
    return process.stdin;
  }) as typeof process.stdin.on);
  vi.spyOn(process.stdin, "pause").mockImplementation(() => {});
}

function clientFor(response = Response.json({ feedback_id: feedbackId })) {
  const requests: Request[] = [];
  const client = new ApiClient({
    auth: { type: "api_key", apiKey: "test-read-only-credential" },
    apiBaseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return response;
    },
  });
  return { client, requests };
}

function captureOutput() {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((_value, callback) => {
    callback?.();
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => {});
  return { stdout, stderr, text: () => stdout.mock.calls.map(([value]) => String(value)).join("") };
}

describe("feedback command", () => {
  it("dispatches a trimmed body with bounded context and existing credentials, returning JSON only", async () => {
    const { client, requests } = clientFor();
    const output = captureOutput();
    await main(["feedback", "  Upload failed on retry  ", "--json"], client);
    expect(requests[0]?.url).toBe("https://api.example.test/v1/feedback");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer test-read-only-credential");
    expect(requests[0]?.headers.get("idempotency-key")).toMatch(/^cli_feedback_/);
    expect(await requests[0]?.json()).toEqual({
      body: "Upload failed on retry",
      context: { surface: "cli", version: CLI_VERSION, command: "feedback" },
    });
    expect(JSON.parse(output.text())).toEqual({ feedback_id: feedbackId, schema_version: SCHEMA_VERSION });
    expect(output.stderr).not.toHaveBeenCalled();
  });

  it("accepts a body beginning with option syntax after the argument separator", async () => {
    const { client, requests } = clientFor();
    captureOutput();
    await main(["feedback", "--json", "--", "--publish fails"], client);
    expect(await requests[0]?.json()).toMatchObject({ body: "--publish fails" });
  });

  it.each(["--color", "--no-color"])("confirms %s without echoing the body or context", async (mode) => {
    const output = captureOutput();
    await feedback(parseArgs(["feedback", "private report text", mode]), clientFor().client);
    expect(output.text().length).toBeGreaterThan(0);
    expect(output.text()).not.toContain("private report text");
    expect(output.text()).not.toContain("version");
    expect(output.text().includes("\x1b[")).toBe(mode === "--color");
  });

  it("suppresses human confirmation with quiet", async () => {
    const output = captureOutput();
    await feedback(parseArgs(["feedback", "private report", "--quiet"]), clientFor().client);
    expect(output.stdout).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(10001)])("rejects invalid body before sending and uses exit 4", async (body) => {
    const { client, requests } = clientFor();
    const error = await feedback(parseArgs(["feedback", body]), client).catch((error: unknown) => error);
    expect(exitCodeFor(error)).toBe(4);
    expect(JSON.parse(formatError("json", error)).error.code).toBe("invalid_request");
    expect(requests).toHaveLength(0);
  });

  it("rejects extra positional arguments before sending", async () => {
    const { client, requests } = clientFor();
    const error = await feedback(parseArgs(["feedback", "report", "extra"]), client).catch((error: unknown) => error);
    expect(exitCodeFor(error)).toBe(4);
    expect(requests).toHaveLength(0);
  });

  it("reads a UTF-8 body across stdin chunk boundaries", async () => {
    const bytes = new TextEncoder().encode("friction café\n");
    mockStdin([bytes.slice(0, 13), bytes.slice(13)]);
    const { client, requests } = clientFor();
    captureOutput();
    await feedback(parseArgs(["feedback", "--json"]), client);
    expect(await requests[0]?.json()).toMatchObject({ body: "friction café" });
  });

  it.each([
    new Uint8Array(),
    new TextEncoder().encode("x".repeat(10001)),
    new Uint8Array([0xff]),
  ])("rejects empty, oversized, or invalid UTF-8 stdin", async (bytes) => {
    mockStdin([bytes]);
    const { client, requests } = clientFor();
    const error = await feedback(parseArgs(["feedback"]), client).catch((error: unknown) => error);
    expect(exitCodeFor(error)).toBe(4);
    expect(requests).toHaveLength(0);
  });

  it("requires a body at an interactive terminal instead of hanging", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const { client, requests } = clientFor();
    await expect(feedback(parseArgs(["feedback"]), client)).rejects.toBeInstanceOf(AgentPasteError);
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      Response.json(
        { error: { code: "invalid_request", message: "invalid_request", request_id: "req_1" } },
        { status: 400 },
      ),
      4,
    ],
    [
      Response.json(
        { error: { code: "not_authenticated", message: "not_authenticated", request_id: "req_1" } },
        { status: 401 },
      ),
      2,
    ],
    [
      Response.json(
        { error: { code: "database_unavailable", message: "database_unavailable", request_id: "req_1" } },
        { status: 503 },
      ),
      6,
    ],
  ])("preserves API failure exit bucket %s", async (response, expectedExit) => {
    const output = captureOutput();
    const error = await feedback(parseArgs(["feedback", "report", "--json"]), clientFor(response).client).catch(
      (error: unknown) => error,
    );
    expect(exitCodeFor(error)).toBe(expectedExit);
    expect(output.stdout).not.toHaveBeenCalled();
  });

  it("uses exit 1 for transport failures", async () => {
    const client = new ApiClient({
      auth: { type: "api_key", apiKey: "test-read-credential" },
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await feedback(parseArgs(["feedback", "report"]), client).catch((error: unknown) => error);
    expect(exitCodeFor(error)).toBe(1);
  });
});
