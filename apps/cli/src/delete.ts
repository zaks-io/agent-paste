import { AgentPasteError, type ApiClient } from "@agent-paste/api-client";
import { ArtifactReference } from "@agent-paste/contracts/primitives";
import { booleanFlag, output, type Parsed, requiredArg } from "./cli-args.js";
export async function deleteArtifact(parsed: Parsed, client: ApiClient) {
  const id = ArtifactReference.parse(requiredArg(parsed, 0, "artifact-id"));
  if (!booleanFlag(parsed, "yes", false))
    throw new AgentPasteError({ code: "invalid_request", status: 400, message: "delete requires --yes" });
  return output(await client.artifacts.delete(id), parsed.global);
}
