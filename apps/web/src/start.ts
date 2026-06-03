import {
  type AnyRequestMiddleware,
  createCsrfMiddleware,
  createServerOnlyFn,
  createStart,
} from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const getServerAuthkitRequestMiddleware = createServerOnlyFn(async (): Promise<AnyRequestMiddleware[]> => {
  const { authkitMiddleware } = await import("@workos/authkit-tanstack-react-start");
  return [authkitMiddleware()];
});

async function getAuthkitRequestMiddleware(): Promise<AnyRequestMiddleware[]> {
  if (!import.meta.env.SSR) return [];
  return getServerAuthkitRequestMiddleware();
}

export const startInstance = createStart(async () => ({
  requestMiddleware: [csrfMiddleware, ...(await getAuthkitRequestMiddleware())],
}));
