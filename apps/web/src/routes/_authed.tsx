import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { CommandPaletteProvider } from "../components/chrome/command-palette/CommandPaletteProvider";
import { Sidebar } from "../components/chrome/Sidebar";
import { Topbar } from "../components/chrome/Topbar";
import { ClaimGuestGate } from "../components/claim/ClaimGuestGate";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { ToastProvider } from "../components/ui/ToastProvider";
import { webSessionQuery } from "../lib/queries";
import { loadAuthedSessionFn } from "../rpc/web-loaders";

export const Route = createFileRoute("/_authed")({
  // Resolve identity from the validated token only (no API call) so navigation
  // paints immediately. Workspace provisioning (a DB write) runs off the critical
  // path via webSessionQuery in the component below. See AP-256.
  loader: async ({ location }) => {
    const allowGuest = location.pathname === "/claim";
    const returnPathname = `${location.pathname}${location.searchStr ?? ""}`;
    const session = await loadAuthedSessionFn({ data: { allowGuest, returnPathname } });
    return session;
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const session = Route.useLoaderData();
  if ("guest" in session && session.guest) {
    return <ClaimGuestGate />;
  }
  if ("redirectTo" in session) {
    return <SignInRedirect href={session.redirectTo} />;
  }
  return <AuthedShell user={session.user} isOperator={session.isOperator} />;
}

function AuthedShell({
  user,
  isOperator,
}: {
  user: Extract<ReturnType<typeof Route.useLoaderData>, { user: unknown }>["user"];
  isOperator: boolean;
}) {
  // Fired after first paint; the cached webSessionQuery means at most one
  // provisioning round-trip per stale window rather than one per navigation.
  const { data: apiSession } = useQuery(webSessionQuery());
  const workspaceName = apiSession?.data?.workspace.name;
  return (
    <ToastProvider>
      <CommandPaletteProvider isOperator={isOperator}>
        <div className="min-h-screen flex flex-col">
          <Topbar user={user} workspaceName={workspaceName} />
          <div className="flex flex-1 min-h-0">
            <Sidebar isOperator={isOperator} />
            <main className="flex-1 min-w-0 overflow-x-auto">
              <div className="mx-auto w-full max-w-[1080px] px-6 py-12 sm:px-10">
                {apiSession?.error ? (
                  <div className="mb-6">
                    <ErrorBanner
                      title="Couldn't provision workspace"
                      message={apiSession.error.message}
                      requestId={apiSession.error.requestId}
                    />
                  </div>
                ) : null}
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </ToastProvider>
  );
}

function SignInRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.assign(href);
  }, [href]);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <p className="text-base text-muted">Redirecting to sign in...</p>
    </main>
  );
}
