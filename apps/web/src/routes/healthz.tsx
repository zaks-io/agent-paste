import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getWebEnv } from "../server/runtime";

const healthFn = createServerFn({ method: "GET" }).handler(async () => {
  const env = getWebEnv();
  return {
    ok: true,
    app: "web",
    env: env.AGENT_PASTE_ENV,
    api_base_url: env.API_BASE_URL,
  };
});

export const Route = createFileRoute("/healthz")({
  loader: () => healthFn(),
  component: HealthPage,
});

function HealthPage() {
  const data = Route.useLoaderData();
  return (
    <main className="p-6 font-mono text-[13px] leading-[1.55]">
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
