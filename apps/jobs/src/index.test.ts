import { describe, expect, it } from "vitest";
import worker, { type Env, runScheduledJobs } from "./index.js";

function request(path: string, env: Env = {}) {
  return worker.fetch(new Request(`https://jobs.test${path}`), env);
}

describe("jobs worker", () => {
  it("reports health as enabled by default", async () => {
    const response = await request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "jobs", enabled: true });
  });

  it("reports health as disabled when jobs are disabled", async () => {
    const response = await request("/healthz", { JOBS_ENABLED: "false" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "jobs", enabled: false });
  });

  it("serves the jobs OpenAPI document", async () => {
    const response = await request("/openapi.json");
    const doc = (await response.json()) as { openapi: string; info: { title: string }; paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Agent Paste Jobs API");
    expect(doc.paths).toHaveProperty("/healthz");
  });

  it("returns a canonical not_found envelope for unknown paths", async () => {
    const response = await request("/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found", message: "not_found" } });
  });

  it("runs scheduled jobs when enabled", async () => {
    await expect(
      runScheduledJobs({ type: "scheduled", scheduledTime: Date.now(), cron: "* * * * *" }, {}),
    ).resolves.toBeUndefined();
  });

  it("skips scheduled jobs when disabled", async () => {
    await expect(
      runScheduledJobs({ type: "scheduled", scheduledTime: Date.now(), cron: "* * * * *" }, { JOBS_ENABLED: "false" }),
    ).resolves.toBeUndefined();
  });
});
