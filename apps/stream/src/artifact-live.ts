import {
  type ArtifactId,
  LIVE_UPDATE_VIEWER_CAP,
  type LiveUpdateAuthorizeResponse,
  LiveUpdateNotifyMessage,
  type LiveUpdatePointer,
} from "@agent-paste/contracts";
import { ArtifactLiveHub } from "./live-hub.js";
import { createSseStream } from "./sse.js";

export type ApiServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

type ConnectPayload = {
  connection_id: string;
  artifact_id: string;
  audience: LiveUpdateAuthorizeResponse["audience"];
  pointer: LiveUpdatePointer;
};

export class ArtifactLiveUpdates implements DurableObject {
  #hub = new ArtifactLiveHub();

  constructor(
    readonly state: DurableObjectState,
    readonly env: { API: ApiServiceBinding },
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/notify" && request.method === "POST") {
      return this.handleNotify(request);
    }
    if (url.pathname === "/sse/connect" && request.method === "POST") {
      return this.handleConnect(request);
    }
    return new Response("not_found", { status: 404 });
  }

  async handleNotify(request: Request): Promise<Response> {
    const body = (await request.json()) as unknown;
    const parsed = LiveUpdateNotifyMessage.safeParse(body);
    if (!parsed.success) {
      return new Response("invalid_request", { status: 400 });
    }
    const message = parsed.data;
    if (message.op === "publish") {
      this.#hub.publish(message.pointer, message.artifact_id as ArtifactId);
      return new Response("ok");
    }
    this.#hub.disconnect(message.audiences, message.reason);
    return new Response("ok");
  }

  async handleConnect(request: Request): Promise<Response> {
    const body = (await request.json()) as unknown;
    if (typeof body !== "object" || body === null) {
      return new Response("invalid_request", { status: 400 });
    }
    const payload = body as Partial<ConnectPayload>;
    if (
      typeof payload.connection_id !== "string" ||
      typeof payload.artifact_id !== "string" ||
      (payload.audience !== "share" && payload.audience !== "dashboard") ||
      !payload.pointer
    ) {
      return new Response("invalid_request", { status: 400 });
    }

    if (this.#hub.connectionCount >= LIVE_UPDATE_VIEWER_CAP) {
      return liveUpdateAtCapResponse();
    }

    const stream = createSseStream({
      signal: request.signal,
      onConnect: (send) => {
        const result = this.#hub.connect({
          id: payload.connection_id as string,
          audience: payload.audience as LiveUpdateAuthorizeResponse["audience"],
          send,
          close: () => {
            this.#hub.remove(payload.connection_id as string);
          },
        });
        if (!result.ok) {
          return;
        }
        send({
          type: "published_revision",
          artifact_id: payload.artifact_id as ArtifactId,
          pointer: payload.pointer as LiveUpdatePointer,
        });
      },
      onClose: () => {
        this.#hub.remove(payload.connection_id as string);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: sseResponseHeaders(),
    });
  }
}

export function sseResponseHeaders(): Headers {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
}

export function liveUpdateAtCapResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: "live_update_at_cap", message: "live_update_at_cap" },
    }),
    {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
