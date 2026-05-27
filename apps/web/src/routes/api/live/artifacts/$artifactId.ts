import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getWebEnv } from "../../../../server/runtime";

export const Route = createFileRoute("/api/live/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const auth = await getAuth();
        if (!auth.user || !auth.accessToken) {
          return new Response(JSON.stringify({ error: { code: "not_found" } }), {
            status: 404,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
        const env = getWebEnv();
        const streamBase = (env.STREAM_BASE_URL ?? "http://127.0.0.1:8791").replace(/\/$/, "");
        const upstream = await fetch(`${streamBase}/v1/live/artifacts/${params.artifactId}`, {
          method: "GET",
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${auth.accessToken}`,
          },
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: upstreamHeaders(upstream.headers),
        });
      },
    },
  },
});

function upstreamHeaders(headers: Headers): Headers {
  const next = new Headers();
  const contentType = headers.get("content-type");
  if (contentType) {
    next.set("content-type", contentType);
  }
  const cacheControl = headers.get("cache-control");
  if (cacheControl) {
    next.set("cache-control", cacheControl);
  }
  return next;
}
