import { type ArtifactId, LiveUpdateNotifyMessage } from "@agent-paste/contracts";
import { liveUpdateAtCapResponse, sseResponseHeaders } from "./artifact-live.js";
import { ArtifactLiveHub } from "./live-hub.js";
import { createSseStream, formatSseEvent } from "./sse.js";

const hubs = new Map<string, ArtifactLiveHub>();

function hubFor(artifactId: string): ArtifactLiveHub {
  let hub = hubs.get(artifactId);
  if (!hub) {
    hub = new ArtifactLiveHub();
    hubs.set(artifactId, hub);
  }
  return hub;
}

export function createMemoryArtifactLiveNamespace() {
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      return {
        async fetch(request: Request): Promise<Response> {
          const url = new URL(request.url);
          const hub = hubFor(id);
          if (url.pathname === "/internal/notify" && request.method === "POST") {
            const body = (await request.json()) as unknown;
            const parsed = LiveUpdateNotifyMessage.safeParse(body);
            if (!parsed.success) {
              return new Response("invalid_request", { status: 400 });
            }
            const message = parsed.data;
            if (message.op === "publish") {
              hub.publish(message.pointer, message.artifact_id as ArtifactId);
              return new Response("ok");
            }
            hub.disconnect(message.audiences, message.reason);
            return new Response("ok");
          }
          if (url.pathname === "/sse/connect" && request.method === "POST") {
            const payload = (await request.json()) as {
              connection_id?: string;
              artifact_id?: string;
              audience?: "share" | "dashboard";
              pointer?: unknown;
            };
            if (
              typeof payload.connection_id !== "string" ||
              typeof payload.artifact_id !== "string" ||
              (payload.audience !== "share" && payload.audience !== "dashboard") ||
              !payload.pointer
            ) {
              return new Response("invalid_request", { status: 400 });
            }
            if (hub.connectionCount >= 10) {
              return liveUpdateAtCapResponse();
            }
            const stream = createSseStream({
              signal: request.signal,
              onConnect: (send) => {
                const result = hub.connect({
                  id: payload.connection_id as string,
                  audience: payload.audience as "share" | "dashboard",
                  send,
                  close: () => hub.remove(payload.connection_id as string),
                });
                if (!result.ok) {
                  return;
                }
                send({
                  type: "published_revision",
                  artifact_id: payload.artifact_id as ArtifactId,
                  pointer: payload.pointer as never,
                });
              },
              onClose: () => hub.remove(payload.connection_id as string),
            });
            return new Response(stream, { headers: sseResponseHeaders() });
          }
          return new Response("not_found", { status: 404 });
        },
      };
    },
  };
}

export function resetMemoryArtifactLiveHubs(): void {
  hubs.clear();
}

export { formatSseEvent };
