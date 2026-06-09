import { type ArtifactId, LIVE_UPDATE_VIEWER_CAP } from "@agent-paste/contracts";
import { liveUpdateAtCapResponse, sseResponseHeaders } from "./artifact-live.js";
import { parseConnectAuth } from "./connection-auth.js";
import type { ArtifactLiveHub } from "./live-hub.js";
import { readMemoryArtifactLiveJsonBody } from "./memory-artifact-live-request.js";
import { createSseStream } from "./sse.js";

type ConnectPayload = {
  connection_id?: string;
  artifact_id?: string;
  audience?: "share" | "dashboard";
  pointer?: unknown;
  auth?: unknown;
};

export async function handleMemoryArtifactLiveConnect(request: Request, hub: ArtifactLiveHub): Promise<Response> {
  const body = await readMemoryArtifactLiveJsonBody(request);
  if (typeof body !== "object" || body === null) {
    return new Response("invalid_request", { status: 400 });
  }
  const payload = body as ConnectPayload;
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
