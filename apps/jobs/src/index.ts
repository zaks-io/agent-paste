import { Hono } from "hono";

export type Env = {
  JOBS_ENABLED?: string;
};

type ScheduledEvent = {
  type: "scheduled";
  scheduledTime: number;
  cron: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (context) =>
  context.json({
    ok: true,
    app: "jobs",
    enabled: context.env.JOBS_ENABLED !== "false",
  }),
);
app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.notFound((context) => context.json({ error: { code: "not_found", message: "not_found" } }, 404));
app.onError((error, context) => {
  console.error("Unhandled jobs error:", error);
  return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await app.fetch(request, env);
  },
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await runScheduledJobs(event, env);
  },
};

export async function runScheduledJobs(_event: ScheduledEvent, env: Env): Promise<void> {
  if (env.JOBS_ENABLED === "false") {
    return;
  }
}

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
