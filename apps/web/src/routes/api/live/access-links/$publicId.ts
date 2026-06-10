import { createFileRoute } from "@tanstack/react-router";
import { accessLinkProxyHeaders, liveStreamProxyHeaders } from "../../../../security-headers";

export const Route = createFileRoute("/api/live/access-links/$publicId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { getWebEnv } = await import("../../../../server/runtime");
        const env = getWebEnv();
        const streamBase = (env.STREAM_BASE_URL ?? "http://127.0.0.1:8791").replace(/\/$/, "");
        const upstream = await fetch(`${streamBase}/v1/live/access-links/${encodeURIComponent(params.publicId)}`, {
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
          headers: liveStreamProxyHeaders(upstream.headers, accessLinkProxyHeaders()),
        });
      },
    },
  },
});
