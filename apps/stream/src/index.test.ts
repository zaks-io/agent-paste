import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest } from "./index.js";

describe("stream worker", () => {
  it("serves health checks", async () => {
    const response = await handleRequest(new Request("https://stream.test/healthz"), {
      API: { fetch: vi.fn() },
      ARTIFACT_LIVE: {
        idFromName: () => "id",
        get: () => ({ fetch: vi.fn() }),
      },
    } as unknown as Env);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("returns not_found for unknown routes", async () => {
    const response = await handleRequest(new Request("https://stream.test/unknown"), {
      API: { fetch: vi.fn() },
      ARTIFACT_LIVE: {
        idFromName: () => "id",
        get: () => ({ fetch: vi.fn() }),
      },
    } as unknown as Env);
    expect(response.status).toBe(404);
  });
});
