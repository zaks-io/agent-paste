import { describe, expect, it, vi } from "vitest";
import type { SqlQueryInstrumentation } from "../types.js";

const runtimeState = vi.hoisted(() => ({
  createHyperdriveExecutor: vi.fn(() => ({ query: vi.fn(), transaction: vi.fn() })),
  createPostgresServices: vi.fn((options: unknown) => ({
    auth: { verifyApiKey: vi.fn() },
    apiDb: options,
    repo: options,
    uploadDb: options,
  })),
}));

vi.mock("./executor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./executor.js")>();
  return {
    ...actual,
    createHyperdriveExecutor: runtimeState.createHyperdriveExecutor,
  };
});

vi.mock("./services.js", () => ({
  createPostgresServices: runtimeState.createPostgresServices,
}));

import { createPostgresRuntime } from "./worker-runtime.js";

describe("createPostgresRuntime", () => {
  it("passes executor options through to the Hyperdrive executor", () => {
    const binding = { connectionString: "postgres://example" };
    const instrumentQuery: SqlQueryInstrumentation = vi.fn((_, run) => run());
    const traceId = vi.fn(() => "0123456789abcdef0123456789abcdef");

    const runtime = createPostgresRuntime(
      { DB: binding, API_KEY_PEPPER_V1: "pepper" },
      {
        executorOptions: { instrumentQuery, traceId },
        pickDb: (services) => services.apiDb,
      },
    );

    expect(runtime).toBeDefined();
    expect(runtimeState.createHyperdriveExecutor).toHaveBeenCalledWith(binding, { instrumentQuery, traceId });
  });
});
