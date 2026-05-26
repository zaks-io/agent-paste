import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { decodeReturnPathname } from "../../../../lib/auth-return-path";

export const Route = createFileRoute("/api/auth/sign-in/p/$encoded")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { encoded: string } }) => {
        const returnPathname = decodeReturnPathname(params.encoded);
        const url = await getSignInUrl(returnPathname ? { data: { returnPathname } } : undefined);
        return new Response(null, {
          status: 307,
          headers: { Location: url },
        });
      },
    },
  },
});
