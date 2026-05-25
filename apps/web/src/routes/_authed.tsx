import type { WebAuthCallbackResponse } from "@agent-paste/contracts";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Sidebar } from "../components/chrome/Sidebar";
import { Topbar } from "../components/chrome/Topbar";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { ToastProvider } from "../components/ui/ToastProvider";
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
  loader: async () => {
    const result = await loadAuthedSessionFn();
    if ("redirectTo" in result) {
      // href must stay query-string-free: a thrown redirect whose href carries
      // a query string trips a router coercion bug under SSR (500 instead of a
      // 307). returnPathname is dropped here as a result; the sign-in handler
      // falls back to its default post-login destination. See web-app-todo.md.
      throw redirect({ href: result.redirectTo });
    }
    return result;
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user, isOperator, apiSession } = Route.useLoaderData();
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
