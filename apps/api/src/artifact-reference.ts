import { ArtifactId } from "@agent-paste/contracts";
import type { ApiActor, Repository } from "@agent-paste/db";
import type { Env } from "./env.js";

export function resolveArtifactReference(
  db: Repository,
  actor: ApiActor,
  env: Pick<Env, "CONTENT_CAPABILITY_DOMAIN" | "CONTENT_CAPABILITY_HOST_SUFFIX">,
  reference: string,
): Promise<string | null> {
  const artifactId = ArtifactId.safeParse(reference);
  if (artifactId.success) {
    return Promise.resolve(artifactId.data);
  }
  if (!reference || reference.startsWith("art_")) {
    return Promise.resolve(reference);
  }
  return db.resolveArtifactReference({
    actor,
    reference,
    ...(env.CONTENT_CAPABILITY_DOMAIN ? { capabilityDomain: env.CONTENT_CAPABILITY_DOMAIN } : {}),
    ...(env.CONTENT_CAPABILITY_HOST_SUFFIX ? { capabilityHostSuffix: env.CONTENT_CAPABILITY_HOST_SUFFIX } : {}),
  });
}
