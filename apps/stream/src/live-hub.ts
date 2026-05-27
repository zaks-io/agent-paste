import {
  type ArtifactId,
  LIVE_UPDATE_AT_CAP_CODE,
  LIVE_UPDATE_VIEWER_CAP,
  type LiveUpdateAudience,
  type LiveUpdatePointer,
  type LiveUpdateRevokedEvent,
  type LiveUpdateSseEvent,
} from "@agent-paste/contracts";

export type LiveConnection = {
  id: string;
  audience: LiveUpdateAudience;
  send: (event: LiveUpdateSseEvent) => void;
  close: () => void;
};

export type ConnectResult =
  | { ok: true; connection: LiveConnection }
  | { ok: false; code: typeof LIVE_UPDATE_AT_CAP_CODE };

export class ArtifactLiveHub {
  #connections = new Map<string, LiveConnection>();
  #lastPointer: LiveUpdatePointer | null = null;

  get connectionCount(): number {
    return this.#connections.size;
  }

  get lastPointer(): LiveUpdatePointer | null {
    return this.#lastPointer;
  }

  connect(input: {
    id: string;
    audience: LiveUpdateAudience;
    send: (event: LiveUpdateSseEvent) => void;
    close: () => void;
  }): ConnectResult {
    if (this.#connections.size >= LIVE_UPDATE_VIEWER_CAP) {
      return { ok: false, code: LIVE_UPDATE_AT_CAP_CODE };
    }
    const connection: LiveConnection = {
      id: input.id,
      audience: input.audience,
      send: input.send,
      close: input.close,
    };
    this.#connections.set(input.id, connection);
    return { ok: true, connection };
  }

  remove(connectionId: string): void {
    this.#connections.delete(connectionId);
  }

  publish(pointer: LiveUpdatePointer, artifactId: ArtifactId): void {
    this.#lastPointer = pointer;
    const event: LiveUpdateSseEvent = {
      type: "published_revision",
      artifact_id: artifactId,
      pointer,
    };
    for (const connection of this.#connections.values()) {
      try {
        connection.send(event);
      } catch {
        // keep fan-out best-effort when one connection's stream is broken
      }
    }
  }

  disconnect(audiences: LiveUpdateAudience[], reason: LiveUpdateRevokedEvent["reason"]): void {
    const audienceSet = new Set(audiences);
    const event: LiveUpdateSseEvent = { type: "revoked", reason };
    for (const [id, connection] of this.#connections) {
      if (!audienceSet.has(connection.audience)) {
        continue;
      }
      try {
        connection.send(event);
      } catch {
        // still close broken connections
      }
      connection.close();
      this.#connections.delete(id);
    }
  }

  disconnectAll(reason: LiveUpdateRevokedEvent["reason"]): void {
    this.disconnect(["share", "dashboard"], reason);
  }
}
