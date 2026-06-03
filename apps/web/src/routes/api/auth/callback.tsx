import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async (input) => {
        const { handleCallbackRoute } = await import("@workos/authkit-tanstack-react-start");
        return handleCallbackRoute({
          returnPathname: "/dashboard",
          errorRedirectUrl: "/?auth_error=callback_failed",
        })(input);
      },
    },
  },
});
