import { ArtifactLiveHub } from "./live-hub.js";

const hubs = new Map<string, ArtifactLiveHub>();

export function hubFor(artifactId: string): ArtifactLiveHub {
  let hub = hubs.get(artifactId);
  if (!hub) {
    hub = new ArtifactLiveHub();
    hubs.set(artifactId, hub);
  }
  return hub;
}

export function resetMemoryArtifactLiveHubs(): void {
  hubs.clear();
}
