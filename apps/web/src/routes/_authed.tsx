import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Sidebar } from "../components/chrome/Sidebar";
import { Topbar } from "../components/chrome/Topbar";
import { isOperator } from "../server/env";
import { getWebEnv } from "../server/runtime";

const loadAuthedSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { redirectTo: "/api/auth/sign-in" as const };
  return {
    user: auth.user,
    accessToken: auth.accessToken,
    isOperator: isOperator(getWebEnv(), auth.user.email),
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
  const { user, isOperator } = Route.useLoaderData();
  return (
    <div className="min-h-screen flex flex-col">
      <Topbar user={user} />
      <div className="flex flex-1 min-h-0">
        <Sidebar isOperator={isOperator} />
        <main className="flex-1 min-w-0 overflow-x-auto">
          <div className="mx-auto w-full max-w-[1040px] px-6 py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
