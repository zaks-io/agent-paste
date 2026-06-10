import { securityHeadersMiddleware, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono } from "hono";
import { runScheduledJobs, type ScheduledEvent } from "./cron.js";
import type { Env } from "./env.js";
import { jobsEnabled } from "./env.js";
import { logOpError } from "./op-log.js";
import { handleQueueBatch, type MessageBatch } from "./queue.js";
import {
  authenticateSmokeHarness,
  isNonProductionEnv,
  runSmokeArtifactPurgeRecovery,
  runSmokeLifecycleCleanup,
} from "./smoke.js";

export { runScheduledJobs } from "./cron.js";
export type { Env } from "./env.js";
export { handleQueueBatch } from "./queue.js";
export {
  authenticateSmokeHarness,
  isNonProductionEnv,
  runFullPurgeRecovery,
  runSmokeArtifactPurgeRecovery,
  runSmokeLifecycleCleanup,
} from "./smoke.js";

export async function runQueueConsumer(batch: MessageBatch, env: Env): Promise<void> {
  if (!jobsEnabled(env)) {
    // Kill switch must never ack: byte-purge enqueue already stamped
    // bytes_purge_enqueued_at, so an acked message is invisible to the
    // recovery sweep. A long disabled window exhausts retries into the DLQ,
    // which is the operator triage path (docs/specs/jobs.md).
    for (const message of batch.messages) {
      message.retry({ delaySeconds: 300 });
    }
    return;
  }
  await handleQueueBatch(batch, env);
}

export async function runScheduledEvent(event: ScheduledEvent, env: Env): Promise<void> {
  try {
    await runScheduledJobs(event, env);
  } catch (error) {
    logOpError("cron.unhandled", {
      cron: event.cron,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeadersMiddleware());
app.get("/healthz", (context) =>
  context.json({
    ok: true,
    app: "jobs",
    enabled: jobsEnabled(context.env),
  }),
);
app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.post("/__test__/run-cleanup", (context) => runSmokeCleanupRoute(context));
app.post("/__test__/purge-recovery", (context) => runSmokePurgeRecoveryRoute(context));
app.notFound((context) => context.json({ error: { code: "not_found", message: "not_found" } }, 404));
app.onError((error, context) => {
  console.error("Unhandled jobs error:", error);
  return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
});

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await app.fetch(request, env);
  },
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await runScheduledEvent(event, env);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await runQueueConsumer(batch, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste Jobs API",
      version: "0.1.0",
    },
    paths: {
      "/healthz": {
        get: {
          operationId: "jobs.health",
          responses: {
            200: {
              description: "Worker health",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
  };
}

async function runSmokeCleanupRoute(context: Context<{ Bindings: Env }>) {
  if (!isNonProductionEnv(context.env) || !authenticateSmokeHarness(context.req.raw, context.env)) {
    return context.json({ error: { code: "not_found", message: "not_found" } }, 404);
  }
  try {
    return context.json(await runSmokeLifecycleCleanup(context.env));
  } catch (error) {
    console.error("Smoke cleanup failed:", error);
    return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
  }
}

async function runSmokePurgeRecoveryRoute(context: Context<{ Bindings: Env }>) {
  if (!isNonProductionEnv(context.env) || !authenticateSmokeHarness(context.req.raw, context.env)) {
    return context.json({ error: { code: "not_found", message: "not_found" } }, 404);
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(context.req.raw);
  } catch {
    return context.json({ error: { code: "invalid_request", message: "invalid_json" } }, 400);
  }
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return context.json({ error: { code: "invalid_request", message: "artifact_id is required" } }, 400);
  }
  try {
    return context.json(await runSmokeArtifactPurgeRecovery(context.env, artifactId));
  } catch (error) {
    console.error("Smoke purge recovery failed:", error);
    return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  const value = await request.json();
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
