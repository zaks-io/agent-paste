import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
import { currentCspNonce } from "./server/csp-nonce";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Show cache instantly on navigation, reconcile in the background.
        staleTime: 10_000,
        refetchOnWindowFocus: true,
      },
    },
  });

  // Per-request CSP nonce (server only; undefined on the client, where TanStack
  // reads it back from the <meta property="csp-nonce"> tag). Setting it here makes
  // TanStack stamp nonce='…' onto every injected SSR script and emit that meta tag.
  const nonce = currentCspNonce();
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 100,
    defaultPendingMinMs: 200,
    ...(nonce ? { ssr: { nonce } } : {}),
  });

  // Dehydrate/hydrate query cache across the SSR boundary and wrap the app in
  // QueryClientProvider (wrapQueryClient defaults to true).
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
