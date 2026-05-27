import {
  type ArtifactId,
  LIVE_UPDATE_VIEWER_CAP,
  type LiveUpdateAuthorizeResponse,
  LiveUpdateNotifyMessage,
  type LiveUpdatePointer,
} from "@agent-paste/contracts";
import { type ApiServiceBinding, parseConnectAuth, resignLiveUpdatePointer } from "./connection-auth.js";
import { ArtifactLiveHub } from "./live-hub.js";
import { createSseStream } from "./sse.js";

export type ArtifactLiveEnv = {
  API: ApiServiceBinding;
  STREAM_INTERNAL_SECRET?: string;
};

type ConnectPayload = {
  connection_id: string;
  artifact_id: string;
  audience: LiveUpdateAuthorizeResponse["audience"];
  pointer: LiveUpdatePointer;
  auth: unknown;
};

export class ArtifactLiveUpdates implements DurableObject {
  #hub = new ArtifactLiveHub();

  constructor(
    readonly state: DurableObjectState,
    readonly env: ArtifactLiveEnv,
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
      await this.#hub.publishRevision(message.revision, message.artifact_id as ArtifactId, async (connection) => {
        const resignOptions = this.env.STREAM_INTERNAL_SECRET
          ? { streamInternalSecret: this.env.STREAM_INTERNAL_SECRET }
          : {};
        const authorized = await resignLiveUpdatePointer(
          this.env.API,
          connection.auth,
          message.artifact_id as ArtifactId,
          resignOptions,
        );
        return authorized?.pointer ?? null;
      });
      return new Response("ok");
    }
    this.#hub.disconnect(message.audiences, message.reason);
    return new Response("ok");
  }

  async handleConnect(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null) {
      return new Response("invalid_request", { status: 400 });
    }
    const payload = body as Partial<ConnectPayload>;
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

    if (this.#hub.connectionCount >= LIVE_UPDATE_VIEWER_CAP) {
      return liveUpdateAtCapResponse();
    }

    const connectionId = payload.connection_id;
    const { stream, close: closeSseStream } = createSseStream({
      signal: request.signal,
      onConnect: (send) => {
        const terminateAndRemove = () => {
          closeSseStream();
          this.#hub.remove(connectionId);
        };
        const result = this.#hub.connect({
          id: connectionId,
          audience: payload.audience as LiveUpdateAuthorizeResponse["audience"],
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
          pointer: payload.pointer as LiveUpdatePointer,
        });
      },
      onClose: () => {
        this.#hub.remove(connectionId);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: sseResponseHeaders(),
    });
  }
}

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
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
