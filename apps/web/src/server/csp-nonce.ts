import { AsyncLocalStorage } from "node:async_hooks";
import { createIsomorphicFn } from "@tanstack/react-start";

// Per-request CSP nonce bridge. server.ts mints a nonce and runs the SSR render
// inside runWithCspNonce; getRouter() and SSR components (called with no args by
// TanStack's request handler) read it via currentCspNonce() to set
// router.options.ssr.nonce and stamp the analytics beacon. AsyncLocalStorage keeps
// it request-scoped, so overlapping requests in the same isolate never share a nonce.
//
// This wiring is required because, in the installed TanStack version, passing the
// nonce through handler.fetch(request, { context }) does NOT reach
// router.options.ssr.nonce — the only field the SSR script-stamping reads.
//
// node:async_hooks is server-only. createIsomorphicFn is a Start-compiler construct:
// it strips the .server() branch (and its node:async_hooks reference) from the client
// bundle, and the .client() no-op runs in the browser, where TanStack instead reads
// the nonce back from the <meta property="csp-nonce"> tag.
let serverStore: AsyncLocalStorage<string> | undefined;

// Instantiated lazily inside the .server() branch so neither the AsyncLocalStorage
// constructor nor the node:async_hooks import is evaluated in the client bundle.
const getStore = createIsomorphicFn()
  .server(() => {
    serverStore ??= new AsyncLocalStorage<string>();
    return serverStore;
  })
  .client(() => undefined);

export function runWithCspNonce<T>(nonce: string, fn: () => T): T {
  const store = getStore();
  return store ? store.run(nonce, fn) : fn();
}

export function currentCspNonce(): string | undefined {
  return getStore()?.getStore();
}
