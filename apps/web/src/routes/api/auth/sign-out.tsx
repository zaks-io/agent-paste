import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/sign-out")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const [{ getAuthkit }, { appendAuthkitHeaders, getServerAuth }] = await Promise.all([
          import("@workos/authkit-tanstack-react-start"),
          import("../../../server/authkit"),
        ]);
        const auth = getServerAuth();
        if (!auth.user) {
          return new Response(null, { status: 303, headers: { Location: new URL("/", request.url).toString() } });
        }
        const authkit = await getAuthkit();
        const result = await authkit.signOut(auth.sessionId);
        const headers = new Headers({ Location: result.logoutUrl });
        appendAuthkitHeaders(headers, result);
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
