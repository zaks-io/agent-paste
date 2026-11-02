import { type ApiClient, createIdempotencyKey } from "@agent-paste/api-client";
import { ArtifactReference } from "@agent-paste/contracts/primitives";
import { output, type Parsed, requiredArg } from "./cli-args.js";
export async function pin(parsed: Parsed, client: ApiClient, pinned: boolean) {
  const id = ArtifactReference.parse(requiredArg(parsed, 0, "artifact-id"));
  const operation = pinned ? client.artifacts.pin : client.artifacts.unpin;
  return output(await operation(id, createIdempotencyKey(pinned ? "pin" : "unpin")), parsed.global);
}
