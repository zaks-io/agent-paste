import { Hono } from "hono";

export type Env = {
  API_BASE_URL?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (context) =>
  context.json({
    ok: true,
    app: "web",
    api_base_url: context.env.API_BASE_URL ?? "https://api.agent-paste.sh",
  }),
);
app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.notFound((context) => context.json({ error: { code: "not_found", message: "not_found" } }, 404));
app.onError((error, context) => {
  console.error("Unhandled web error:", error);
  return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await app.fetch(request, env);
  },
};

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste Web",
      version: "0.1.0",
    },
    paths: {
      "/healthz": {
        get: {
          operationId: "web.health",
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
