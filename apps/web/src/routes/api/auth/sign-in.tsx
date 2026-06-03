import { createFileRoute } from "@tanstack/react-router";
import { parseReturnPathname } from "../../../lib/auth-return-path";

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { getSignInUrl } = await import("@workos/authkit-tanstack-react-start");
        const returnPathname = parseReturnPathname(new URL(request.url).searchParams.get("returnPathname"));
        const url = await getSignInUrl(returnPathname ? { data: { returnPathname } } : undefined);
        return new Response(null, {
          status: 307,
          headers: { Location: url },
        });
      },
    },
  },
});
