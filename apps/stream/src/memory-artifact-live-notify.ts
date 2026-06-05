import { type ArtifactId, LiveUpdateNotifyMessage } from "@agent-paste/contracts";
import { type ApiServiceBinding, resignLiveUpdatePointer } from "./connection-auth.js";
import type { ArtifactLiveHub } from "./live-hub.js";
import { readMemoryArtifactLiveJsonBody } from "./memory-artifact-live-request.js";

export async function handleMemoryArtifactLiveNotify(
  request: Request,
  hub: ArtifactLiveHub,
  api: ApiServiceBinding,
  streamInternalSecret?: string,
): Promise<Response> {
  const body = await readMemoryArtifactLiveJsonBody(request);
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
      const resignOptions = streamInternalSecret ? { streamInternalSecret } : {};
      const authorized = await resignLiveUpdatePointer(
        api,
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
