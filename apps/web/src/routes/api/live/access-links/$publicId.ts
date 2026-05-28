import { createFileRoute } from "@tanstack/react-router";
import { accessLinkProxyHeaders } from "../../../../security-headers";
import { getWebEnv } from "../../../../server/runtime";

export const Route = createFileRoute("/api/live/access-links/$publicId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const env = getWebEnv();
        const streamBase = (env.STREAM_BASE_URL ?? "http://127.0.0.1:8791").replace(/\/$/, "");
        const upstream = await fetch(`${streamBase}/v1/live/access-links/${params.publicId}`, {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": request.headers.get("content-type") ?? "application/json",
          },
          body: await request.text(),
          signal: request.signal,
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
  const next = accessLinkProxyHeaders();
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
