import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebEnv } from "../src/server/env";

const handlerFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-paste/worker-runtime", () => ({
  BASELINE_SECURITY_HEADERS: {
    "X-Content-Type-Options": "nosniff",
  },
  generateCspNonce: () => "test-nonce",
  sentryOptions: () => ({}),
}));

vi.mock("@sentry/cloudflare", () => ({
  withSentry: (_options: unknown, worker: unknown) => worker,
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: (request: Request) => handlerFetch(request),
  },
}));

import { handleRequest } from "../src/server";

const env = {
  AGENT_PASTE_ENV: "production",
  API_BASE_URL: "https://api.agent-paste.sh",
  CONTENT_BASE_URL: "https://usercontent.agent-paste.sh",
  WEB_BASE_URL: "https://app.agent-paste.sh",
  WORKOS_CLIENT_ID: "client",
  WORKOS_API_KEY: "key",
  WORKOS_REDIRECT_URI: "https://app.agent-paste.sh/api/auth/callback",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
  ASSETS: {
    fetch: async () => new Response(null, { status: 404 }),
    connect: () => {
      throw new Error("ASSETS.connect is not used in tests");
    },
  },
} satisfies WebEnv;

describe("web worker", () => {
  beforeEach(() => {
    handlerFetch.mockReset();
  });

  it("serves /healthz as raw JSON without rendering the app shell", async () => {
    const response = await handleRequest(new Request("https://app.agent-paste.sh/healthz"), env);

    expect(handlerFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({ ok: true, app: "web" });
  });

  it("renders non-health routes through TanStack Start", async () => {
    handlerFetch.mockResolvedValueOnce(new Response("app", { headers: { "content-type": "text/html" } }));

    const response = await handleRequest(new Request("https://app.agent-paste.sh/dashboard"), env);

    expect(handlerFetch).toHaveBeenCalledOnce();
    expect(response.headers.get("content-type")).toBe("text/html");
    await expect(response.text()).resolves.toBe("app");
  });
});
