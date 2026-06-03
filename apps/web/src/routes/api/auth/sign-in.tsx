import { createFileRoute } from "@tanstack/react-router";
import { parseReturnPathname } from "../../../lib/auth-return-path";

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const [{ getAuthkit }, { appendAuthkitHeaders }, { getWebEnv }] = await Promise.all([
          import("@workos/authkit-tanstack-react-start"),
          import("../../../server/authkit"),
          import("../../../server/runtime"),
        ]);
        const returnPathname = parseReturnPathname(new URL(request.url).searchParams.get("returnPathname"));
        const authkit = await getAuthkit();
        const result = await authkit.createSignIn(undefined, {
          redirectUri: getWebEnv().WORKOS_REDIRECT_URI,
          ...(returnPathname ? { returnPathname } : {}),
        });
        const headers = new Headers({ Location: result.url });
        appendAuthkitHeaders(headers, result);
        return new Response(null, {
          status: 307,
          headers,
        });
      },
    },
  },
});
