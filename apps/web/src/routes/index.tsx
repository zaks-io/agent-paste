import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Wordmark } from "../components/chrome/Wordmark";
import { ErrorBanner } from "../components/ui/ErrorBanner";

type Search = { auth_error?: string };

export const Route = createFileRoute("/")({
  validateSearch: (input: Record<string, unknown>): Search =>
    typeof input.auth_error === "string" ? { auth_error: input.auth_error } : {},
  loader: async ({ location }) => {
    const search = location.search as Search;
    if (search.auth_error) return { auth_error: search.auth_error };
    const { user } = await getAuth();
    throw redirect({ href: user ? "/dashboard" : "/api/auth/sign-in" });
  },
  component: HomePage,
});

function HomePage() {
  const data = Route.useLoaderData();
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-[380px] grid gap-8">
        <div className="flex justify-center">
          <Wordmark />
        </div>
        {data?.auth_error ? <ErrorBanner title="Sign in failed" message="That didn't complete. Try again." /> : null}
        <a
          href="/api/auth/sign-in"
          className="
            block text-center px-4 h-10 leading-10
            rounded-[var(--radius-sm)]
            bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]
            hover:opacity-90 transition-opacity duration-[80ms]
            text-[14px] font-medium
          "
        >
          Continue with WorkOS
        </a>
      </div>
    </main>
  );
}
