import { type ArtifactId, LIVE_UPDATE_VIEWER_CAP, LiveUpdateNotifyMessage } from "@agent-paste/contracts";
import { liveUpdateAtCapResponse, sseResponseHeaders } from "./artifact-live.js";
import { type ApiServiceBinding, parseConnectAuth, resignLiveUpdatePointer } from "./connection-auth.js";
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

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export type MemoryArtifactLiveOptions = {
  api: ApiServiceBinding;
  streamInternalSecret?: string;
};

export function createMemoryArtifactLiveNamespace(options: MemoryArtifactLiveOptions) {
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      return {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: known offender (35), pending ratchet toward 15 — see docs/ops/complexity-todo.md
        async fetch(request: Request): Promise<Response> {
          const url = new URL(request.url);
          const hub = hubFor(id);
          if (url.pathname === "/internal/notify" && request.method === "POST") {
            const body = await readJsonBody(request);
            if (body === null) {
              return new Response("invalid_request", { status: 400 });
            }
            const parsed = LiveUpdateNotifyMessage.safeParse(body);
            if (!parsed.success) {
              return new Response("invalid_request", { status: 400 });
            }
            const message = parsed.data;
            if (message.op === "publish") {
              await hub.publishRevision(message.revision, message.artifact_id as ArtifactId, async (connection) => {
                const resignOptions = options.streamInternalSecret
                  ? { streamInternalSecret: options.streamInternalSecret }
                  : {};
                const authorized = await resignLiveUpdatePointer(
                  options.api,
                  connection.auth,
                  message.artifact_id as ArtifactId,
                  resignOptions,
                );
                return authorized?.pointer ?? null;
              });
              return new Response("ok");
            }
            hub.disconnect(message.audiences, message.reason);
            return new Response("ok");
          }
          if (url.pathname === "/sse/connect" && request.method === "POST") {
            const body = await readJsonBody(request);
            if (typeof body !== "object" || body === null) {
              return new Response("invalid_request", { status: 400 });
            }
            const payload = body as {
              connection_id?: string;
              artifact_id?: string;
              audience?: "share" | "dashboard";
              pointer?: unknown;
              auth?: unknown;
            };
            const auth = parseConnectAuth(payload.auth);
            if (
              typeof payload.connection_id !== "string" ||
              typeof payload.artifact_id !== "string" ||
              (payload.audience !== "share" && payload.audience !== "dashboard") ||
              !payload.pointer ||
              !auth
            ) {
              return new Response("invalid_request", { status: 400 });
            }
            if (hub.connectionCount >= LIVE_UPDATE_VIEWER_CAP) {
              return liveUpdateAtCapResponse();
            }
            const connectionId = payload.connection_id;
            const { stream, close: closeSseStream } = createSseStream({
              signal: request.signal,
              onConnect: (send) => {
                const terminateAndRemove = () => {
                  closeSseStream();
                  hub.remove(connectionId);
                };
                const result = hub.connect({
                  id: connectionId,
                  audience: payload.audience as "share" | "dashboard",
                  auth,
                  send,
                  close: terminateAndRemove,
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
              onClose: () => hub.remove(connectionId),
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
