import type { LiveUpdateSseEvent } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { handleRequest, type Env as StreamEnv } from "../../../stream/src/index.js";
import {
  createMemoryArtifactLiveNamespace,
  resetMemoryArtifactLiveHubs,
} from "../../../stream/src/memory-artifact-live.js";
import type { Env as ApiEnv } from "../env.js";
import {
  handleLiveUpdateAuthorize,
  notifyLiveUpdateDisconnect,
  notifyLiveUpdateDisconnectWorkspace,
  notifyLiveUpdatePublish,
  wireLiveUpdateDeps,
} from "../live-updates.js";

export const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
export const initialRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
export const updatedRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const accessLinkPublicId = "AAAAAAAAAAAAAAAA";
export const streamSecret = "stream-internal-secret";
export const accessLinkSigningSecret = "access-link-secret";

export type LiveUpdatesE2eHarness = {
  apiEnv: ApiEnv;
  streamEnv: StreamEnv;
  accessLinkBlob: string;
  setCurrentRevisionId(revisionId: string): void;
  connectShareLiveUpdates(): Promise<Response>;
  connectDashboardLiveUpdates(authorization?: string): Promise<Response>;
  notifyPublish(revisionId: string): Promise<void>;
  notifyDisconnect(
    audiences: Array<"share" | "dashboard">,
    reason: "access_link_lockdown" | "platform_lockdown" | "deletion" | "takedown",
  ): Promise<void>;
  notifyWorkspaceDisconnect(
    audiences: Array<"share" | "dashboard">,
    reason: "access_link_lockdown" | "platform_lockdown" | "deletion" | "takedown",
  ): Promise<void>;
};

export function createLiveUpdatesE2eHarness(options?: { includeSecondArtifact?: boolean }): LiveUpdatesE2eHarness {
  resetMemoryArtifactLiveHubs();

  let currentRevisionId = initialRevisionId;
  const secondArtifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";

  wireLiveUpdateDeps({
    signAgentView: async (view) => ({
      ...(view as object),
      revision_content_url: pointerForRevision(
        (view as { artifact_id: string; revision_id: string }).artifact_id,
        (view as { revision_id: string }).revision_id,
      ),
    }),
    authenticateWeb: async (authorization) =>
      authorization === "Bearer member" ? { member: { workspace_id: workspaceId } as never } : null,
  });

  const apiEnv = {
    ACCESS_LINK_SIGNING_KEY_V1: accessLinkSigningSecret,
    CONTENT_BASE_URL: "https://content.test",
    STREAM_INTERNAL_SECRET: streamSecret,
    ARTIFACT_RATE_LIMIT: {
      limit: async () => ({ success: true }),
    },
  } as ApiEnv;

  const db = createLiveUpdateDb({
    currentRevisionId: () => currentRevisionId,
    includeSecondArtifact: options?.includeSecondArtifact ?? false,
    secondArtifactId,
  });

  const apiBinding = {
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/internal/live-updates/authorize") {
        return handleLiveUpdateAuthorize(request, apiEnv, db);
      }
      return new Response("not_found", { status: 404 });
    },
  };

  const artifactLive = createMemoryArtifactLiveNamespace({
    api: apiBinding,
    streamInternalSecret: streamSecret,
  });
  apiEnv.ARTIFACT_LIVE = artifactLive as ApiEnv["ARTIFACT_LIVE"];

  const streamEnv = {
    API: apiBinding,
    ARTIFACT_LIVE: artifactLive as StreamEnv["ARTIFACT_LIVE"],
    STREAM_INTERNAL_SECRET: streamSecret,
  };

  let accessLinkBlob = "";

  const harness: LiveUpdatesE2eHarness = {
    apiEnv,
    streamEnv,
    accessLinkBlob,
    setCurrentRevisionId(revisionId: string) {
      currentRevisionId = revisionId;
    },
    async connectShareLiveUpdates() {
      const blob =
        accessLinkBlob ||
        (await mintAccessLinkBlob({
          publicId: accessLinkPublicId,
          kid: 1,
          exp: Date.now() + 60_000,
          scopes: 1,
          signingSecret: accessLinkSigningSecret,
        }));
      accessLinkBlob = blob;
      harness.accessLinkBlob = blob;
      return handleRequest(
        new Request(`https://stream.test/v1/live/access-links/${accessLinkPublicId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blob }),
        }),
        streamEnv,
      );
    },
    async connectDashboardLiveUpdates(authorization = "Bearer member") {
      return handleRequest(
        new Request(`https://stream.test/v1/live/artifacts/${artifactId}`, {
          method: "GET",
          headers: { authorization },
        }),
        streamEnv,
      );
    },
    async notifyPublish(revisionId: string) {
      await notifyLiveUpdatePublish(apiEnv, {
        artifactId,
        revision: {
          revision_id: revisionId,
          entrypoint: "index.html",
          render_mode: "html",
          title: "Demo",
        },
      });
    },
    async notifyDisconnect(audiences, reason) {
      await notifyLiveUpdateDisconnect(apiEnv, { artifactId, audiences, reason });
    },
    async notifyWorkspaceDisconnect(audiences, reason) {
      await notifyLiveUpdateDisconnectWorkspace(apiEnv, db, { workspaceId, audiences, reason });
    },
  };

  return harness;
}

function pointerForRevision(artifact: string, revisionId: string) {
  return `https://content.test/v/${artifact}.${revisionId}/index.html`;
}

function createLiveUpdateDb(options: {
  currentRevisionId: () => string;
  includeSecondArtifact: boolean;
  secondArtifactId: string;
}): Repository {
  return {
    async resolveAccessLink() {
      const revisionId = options.currentRevisionId();
      return {
        access_link_id: "al_test",
        access_link_type: "share",
        workspace_id: workspaceId,
        render_mode: "html",
        title: "Shared",
        iframe_src: pointerForRevision(artifactId, revisionId),
        agent_view: {
          artifact_id: artifactId,
          revision_id: revisionId,
          title: "Shared",
          created_at: "2026-01-01T00:00:00.000Z",
          expires_at: "2030-01-01T00:00:00.000Z",
          entrypoint: "index.html",
          revision_content_url: pointerForRevision(artifactId, revisionId),
          files: [],
        },
      };
    },
    async getAgentView() {
      const revisionId = options.currentRevisionId();
      return {
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "Dashboard",
        entrypoint: "index.html",
        expires_at: "2030-01-01T00:00:00.000Z",
      };
    },
    async listArtifacts() {
      const rows = [{ id: artifactId }];
      if (options.includeSecondArtifact) {
        rows.push({ id: options.secondArtifactId });
      }
      return { data: rows };
    },
  } as unknown as Repository;
}

export function createSseCollector(response: Response) {
  const events: LiveUpdateSseEvent[] = [];
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response is missing a body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  const pump = (async () => {
    while (!closed) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = drainSseBuffer(buffer, events);
    }
  })();

  return {
    get events() {
      return events;
    },
    async waitFor(count: number, timeoutMs = 5_000): Promise<LiveUpdateSseEvent[]> {
      const deadline = Date.now() + timeoutMs;
      while (!closed && events.length < count && Date.now() < deadline) {
        await Promise.race([pump, sleep(Math.min(25, deadline - Date.now()))]);
      }
      if (closed) {
        throw new Error("SSE collector closed before enough events arrived");
      }
      if (events.length < count) {
        throw new Error(`Timed out waiting for ${count} SSE events; received ${events.length}`);
      }
      return events.slice(0, count);
    },
    async close() {
      closed = true;
      await reader.cancel().catch(() => {});
      await pump.catch(() => {});
    },
  };
}

function drainSseBuffer(buffer: string, events: LiveUpdateSseEvent[]): string {
  let remaining = buffer;
  while (true) {
    const frameEnd = remaining.indexOf("\n\n");
    if (frameEnd === -1) {
      return remaining;
    }
    const frame = remaining.slice(0, frameEnd);
    remaining = remaining.slice(frameEnd + 2);
    const parsed = parseSseFrame(frame);
    if (parsed) {
      events.push(parsed);
    }
  }
}

function parseSseFrame(frame: string): LiveUpdateSseEvent | null {
  const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    return null;
  }
  try {
    return JSON.parse(dataLine.slice("data: ".length)) as LiveUpdateSseEvent;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { resetMemoryArtifactLiveHubs };
