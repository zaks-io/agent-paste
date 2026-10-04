import * as Sentry from "@sentry/cloudflare";

// Service bindings bypass global fetch instrumentation, including Web's raw env
// and the named MCP RPC entrypoints in the pinned SDK.
export function traceServiceRequest(
  request: Request,
  name: string,
  send: (request: Request) => Promise<Response>,
): Promise<Response> {
  return Sentry.startSpan(
    { name, op: "http.client", attributes: { "http.request.method": request.method } },
    async (span) => {
      const headers = new Headers(request.headers);
      for (const [key, value] of Object.entries(Sentry.getTraceData({ propagateTraceparent: true }))) {
        if (value) headers.set(key, value);
      }
      const response = await send(new Request(request, { headers }));
      Sentry.setHttpStatus(span, response.status);
      return response;
    },
  );
}
