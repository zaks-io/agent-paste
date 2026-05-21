import { routeApex } from "./routes.js";

export type Env = {
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const response = routeApex(request);
  if (response) {
    return response;
  }

  if (env.ASSETS) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }
  }

  return new Response("not_found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
