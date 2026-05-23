import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const healthFn = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: true, app: "web" };
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
