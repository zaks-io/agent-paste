import {
  type ArtifactId,
  LIVE_UPDATE_AT_CAP_CODE,
  LIVE_UPDATE_VIEWER_CAP,
  type LiveUpdateAudience,
  type LiveUpdatePointer,
  type LiveUpdateRevisionNotice,
  type LiveUpdateRevokedEvent,
  type LiveUpdateSseEvent,
} from "@agent-paste/contracts";
import type { LiveConnectionAuth } from "./connection-auth.js";

export type LiveConnection = {
  id: string;
  audience: LiveUpdateAudience;
  auth: LiveConnectionAuth;
  send: (event: LiveUpdateSseEvent) => void;
  close: () => void;
};

export type ConnectResult =
  | { ok: true; connection: LiveConnection }
  | { ok: false; code: typeof LIVE_UPDATE_AT_CAP_CODE };

export class ArtifactLiveHub {
  #connections = new Map<string, LiveConnection>();

  get connectionCount(): number {
    return this.#connections.size;
  }

  connect(input: {
    id: string;
    audience: LiveUpdateAudience;
    auth: LiveConnectionAuth;
    send: (event: LiveUpdateSseEvent) => void;
    close: () => void;
  }): ConnectResult {
    if (this.#connections.size >= LIVE_UPDATE_VIEWER_CAP) {
      return { ok: false, code: LIVE_UPDATE_AT_CAP_CODE };
    }
    const connection: LiveConnection = {
      id: input.id,
      audience: input.audience,
      auth: input.auth,
      send: input.send,
      close: input.close,
    };
    this.#connections.set(input.id, connection);
    return { ok: true, connection };
  }

  remove(connectionId: string): void {
    this.#connections.delete(connectionId);
  }

  async publishRevision(
    revision: LiveUpdateRevisionNotice,
    artifactId: ArtifactId,
    resign: (connection: LiveConnection) => Promise<LiveUpdatePointer | null>,
  ): Promise<void> {
    for (const [id, connection] of [...this.#connections.entries()]) {
      try {
        const pointer = await resign(connection);
        if (!pointer || pointer.revision_id !== revision.revision_id) {
          this.#revokeConnection(connection, lockdownReasonForAudience(connection.audience));
          this.#connections.delete(id);
          continue;
        }
        connection.send({
          type: "published_revision",
          artifact_id: artifactId,
          pointer,
        });
      } catch {
        this.#revokeConnection(connection, lockdownReasonForAudience(connection.audience));
        this.#connections.delete(id);
      }
    }
  }

  disconnect(audiences: LiveUpdateAudience[], reason: LiveUpdateRevokedEvent["reason"]): void {
    const audienceSet = new Set(audiences);
    for (const [id, connection] of this.#connections) {
      if (!audienceSet.has(connection.audience)) {
        continue;
      }
      this.#revokeConnection(connection, reason);
      this.#connections.delete(id);
    }
  }

  disconnectAll(reason: LiveUpdateRevokedEvent["reason"]): void {
    this.disconnect(["share", "dashboard"], reason);
  }

  #revokeConnection(connection: LiveConnection, reason: LiveUpdateRevokedEvent["reason"]): void {
    const event: LiveUpdateSseEvent = { type: "revoked", reason };
    try {
      connection.send(event);
    } catch {
      // still close broken connections
    }
    try {
      connection.close();
    } catch {
      // keep disconnecting remaining viewers when one close handler throws
    }
  }
}

function lockdownReasonForAudience(audience: LiveUpdateAudience): LiveUpdateRevokedEvent["reason"] {
  return audience === "share" ? "access_link_lockdown" : "platform_lockdown";
}
