import type { WebAuthCallbackResponse } from "@agent-paste/contracts";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Sidebar } from "../components/chrome/Sidebar";
import { Topbar } from "../components/chrome/Topbar";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { ToastProvider } from "../components/ui/ToastProvider";
import { signInBridgeHref } from "../lib/auth-return-path";
import { apiFetchOrEmpty } from "../server/api-client";
import { isOperator } from "../server/env";
import { getWebEnv } from "../server/runtime";

const loadAuthedSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { redirectTo: "/api/auth/sign-in" as const };
  const apiSession = await apiFetchOrEmpty<WebAuthCallbackResponse>("/v1/auth/web/callback", {
    method: "POST",
    accessToken: auth.accessToken,
  });
  return {
    user: auth.user,
    isOperator: isOperator(getWebEnv(), auth.user.email),
    apiSession,
  };
});

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const result = await loadAuthedSessionFn();
    if ("redirectTo" in result) {
      // Thrown redirect hrefs must stay query-string-free (TanStack Router SSR
      // coercion bug). Thread returnPathname through the sign-in bridge route
      // instead: /api/auth/sign-in/p/{base64url(pathname)}.
      const returnPathname = location.search ? `${location.pathname}${location.search}` : location.pathname;
      throw redirect({ href: signInBridgeHref(returnPathname) });
    }
    return result;
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user, isOperator, apiSession } = Route.useRouteContext();
  return (
    <ToastProvider>
      <div className="min-h-screen flex flex-col">
        <Topbar user={user} />
        <div className="flex flex-1 min-h-0">
          <Sidebar isOperator={isOperator} />
          <main className="flex-1 min-w-0 overflow-x-auto">
            <div className="mx-auto w-full max-w-[1040px] px-6 py-10">
              {apiSession.error ? (
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
    </ToastProvider>
  );
}
