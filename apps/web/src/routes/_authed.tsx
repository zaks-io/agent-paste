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
  loader: async ({ location }) => {
    const result = await loadAuthedSessionFn();
    if ("redirectTo" in result) {
      const returnPath = location.pathname + location.search;
      const params = new URLSearchParams({ returnPathname: returnPath });
      throw redirect({ href: `${result.redirectTo}?${params.toString()}` });
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
