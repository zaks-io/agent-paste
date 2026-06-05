import type { ApiServiceBinding } from "./connection-auth.js";
import { handleMemoryArtifactLiveConnect } from "./memory-artifact-live-connect.js";
import { hubFor, resetMemoryArtifactLiveHubs } from "./memory-artifact-live-hub.js";
import { handleMemoryArtifactLiveNotify } from "./memory-artifact-live-notify.js";
import { formatSseEvent } from "./sse.js";

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
        async fetch(request: Request): Promise<Response> {
          const url = new URL(request.url);
          const hub = hubFor(id);
          if (url.pathname === "/internal/notify" && request.method === "POST") {
            return handleMemoryArtifactLiveNotify(request, hub, options.api, options.streamInternalSecret);
          }
          if (url.pathname === "/sse/connect" && request.method === "POST") {
            return handleMemoryArtifactLiveConnect(request, hub);
          }
          return new Response("not_found", { status: 404 });
        },
      };
    },
  };
}

export { resetMemoryArtifactLiveHubs };
export { formatSseEvent };
