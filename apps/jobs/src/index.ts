import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { runScheduledJobs, type ScheduledEvent } from "./cron.js";
import type { Env } from "./env.js";
import { jobsEnabled } from "./env.js";
import { handleQueueBatch, type MessageBatch } from "./queue.js";

export { runScheduledJobs } from "./cron.js";
export type { Env } from "./env.js";
export { handleQueueBatch } from "./queue.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (context) =>
  context.json({
    ok: true,
    app: "jobs",
    enabled: jobsEnabled(context.env),
  }),
);
app.get("/openapi.json", (context) => context.json(openApiDocument()));
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
    await runScheduledJobs(event, env);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (!jobsEnabled(env)) {
      for (const message of batch.messages) {
        message.ack();
      }
      return;
    }
    await handleQueueBatch(batch, env);
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
