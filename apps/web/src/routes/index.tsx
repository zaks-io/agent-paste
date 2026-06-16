import { OPERATING_COMPANY } from "@agent-paste/brand";
import { Wordmark } from "@agent-paste/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { publicPageMeta } from "../lib/page-meta";
import { loadRootAuthFn } from "../rpc/web-loaders";

type Search = { auth_error?: string };

export const Route = createFileRoute("/")({
  validateSearch: (input: Record<string, unknown>): Search =>
    typeof input.auth_error === "string" ? { auth_error: input.auth_error } : {},
  head: ({ matches }) =>
    publicPageMeta({
      title: "Sign in",
      description: "Sign in to agent-paste with WorkOS to manage your workspace and artifacts.",
      path: "/",
      social: true,
      matches,
    }),
  loader: async ({ location }) => {
    const search = location.search as Search;
    if (search.auth_error) return { auth_error: search.auth_error };
    const { signedIn, signInHref } = await loadRootAuthFn();
    throw redirect({ href: signedIn ? "/dashboard" : signInHref });
  },
  component: HomePage,
});

function HomePage() {
  const data = Route.useLoaderData() as Search | undefined;
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-[400px]">
        <div className="rise grid gap-8 text-center">
          <div className="flex justify-center">
            <Wordmark />
          </div>
          <div className="grid gap-3">
            <p className="text-mono-sm font-semibold uppercase tracking-eyebrow text-accent">Workspace</p>
            <h1 className="font-display text-h1 leading-tight text-foreground">
              The record room for what your agents publish.
            </h1>
            <p className="mx-auto max-w-[34ch] text-base leading-relaxed text-muted">
              Sign in to manage artifacts, keys, and the audit trail for your workspace.
            </p>
          </div>
          {data?.auth_error ? <ErrorBanner title="Sign in failed" message="That didn't complete. Try again." /> : null}
          <a
            href="/api/auth/sign-in"
            className="
              flex h-11 items-center justify-center rounded-md
              bg-accent text-base font-medium text-accent-foreground
              shadow-[0_1px_2px_hsl(0_0%_0%/0.2)]
              transition-colors duration-150 ease-out hover:bg-accent-dim
            "
          >
            Continue with WorkOS
          </a>
          <p className="mx-auto max-w-[34ch] font-mono text-mono-sm leading-relaxed text-faint">
            Accounts and billing are operated by{" "}
            <a
              className="text-subtle underline decoration-accent/40 underline-offset-2 transition-colors duration-150 ease-out hover:text-accent"
              href={OPERATING_COMPANY.href}
            >
              {OPERATING_COMPANY.name}
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
