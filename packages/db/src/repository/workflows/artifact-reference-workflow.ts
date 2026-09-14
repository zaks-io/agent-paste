import { ArtifactId } from "@agent-paste/contracts";
import { contentCapabilityIdFromHostname, isContentCapabilityId } from "@agent-paste/tokens/content-capability";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";

type ArtifactReferenceInput = {
  actor: ApiActor;
  reference: string;
  capabilityDomain?: string;
  capabilityHostSuffix?: string;
};

export async function resolveArtifactReference(
  ctx: RepositoryCoreContext,
  input: ArtifactReferenceInput,
): Promise<string | null> {
  const artifactId = ArtifactId.safeParse(input.reference);
  if (artifactId.success) {
    return artifactId.data;
  }

  const capabilityId = capabilityIdFromReference(input);
  if (!capabilityId) {
    return null;
  }

  const artifact = await ctx.uow.read({ kind: "workspace", workspaceId: input.actor.workspace_id }, (entities) =>
    entities.artifacts.findByCapabilityId(capabilityId, input.actor.workspace_id),
  );
  return artifact?.id ?? null;
}

function capabilityIdFromReference(input: ArtifactReferenceInput): string | null {
  if (!input.capabilityDomain) {
    return null;
  }

  if (hasUnsafeUrlCharacters(input.reference)) {
    return null;
  }
  const normalizedReference = input.reference.toLowerCase();
  if (isContentCapabilityId(normalizedReference)) {
    return normalizedReference;
  }
  if (!/^https:\/\//iu.test(input.reference)) {
    return contentCapabilityIdFromHostname(
      `${normalizedReference}.${input.capabilityDomain}`,
      input.capabilityDomain,
      input.capabilityHostSuffix,
    );
  }
  const authority = /^https:\/\/([^/?#]*)/iu.exec(input.reference)?.[1];
  if (!authority || authority.includes(":") || authority.includes("@")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input.reference);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null;
  }

  return contentCapabilityIdFromHostname(url.hostname, input.capabilityDomain, input.capabilityHostSuffix);
}

function hasUnsafeUrlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || character === "\\") {
      return true;
    }
  }
  return false;
}
