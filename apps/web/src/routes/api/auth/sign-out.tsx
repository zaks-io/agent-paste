import { createFileRoute } from "@tanstack/react-router";
import { signOut } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/api/auth/sign-out")({
  server: {
    handlers: {
      POST: async () => {
        await signOut();
      },
    },
  },
});
