import type { AccessLinkResolveResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { accessLinkProxyHeaders } from "../../../security-headers";
import { ApiError, apiFetch } from "../../../server/api-client";

export const Route = createFileRoute("/api/access-links/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return resolveErrorResponse(400);
        }
        try {
          const data = await apiFetch<AccessLinkResolveResponse>("/v1/access-links/resolve", {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          return Response.json(data, {
            status: 200,
            headers: accessLinkProxyHeaders(),
          });
        } catch (error) {
          if (error instanceof ApiError) {
            if (error.status === 404) {
              return resolveErrorResponse(404);
            }
            if (error.status === 429) {
              return Response.json(
                { error: { code: "rate_limited_artifact", message: error.message } },
                {
                  status: 429,
                  headers: accessLinkProxyHeaders({ "retry-after": "60" }),
                },
              );
            }
          }
          return resolveErrorResponse(503);
        }
      },
    },
  },
});

function resolveErrorResponse(status: number): Response {
  const code = status === 404 ? "not_found" : status === 400 ? "invalid_request" : "database_unavailable";
  return Response.json(
    { error: { code } },
    {
      status,
      headers: accessLinkProxyHeaders(),
    },
  );
}
