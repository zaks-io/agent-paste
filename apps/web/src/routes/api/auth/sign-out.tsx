import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/sign-out")({
  server: {
    handlers: {
      POST: async () => {
        const { signOut } = await import("@workos/authkit-tanstack-react-start");
        await signOut();
      },
    },
  },
});
