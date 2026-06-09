import { createFileRoute } from "@tanstack/react-router";
import { healthFn } from "../rpc/web-loaders";

export const Route = createFileRoute("/healthz")({
  loader: () => healthFn(),
  component: HealthPage,
});

function HealthPage() {
  const data = Route.useLoaderData();
  return (
    <main className="p-6 font-mono text-sm leading-relaxed">
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
