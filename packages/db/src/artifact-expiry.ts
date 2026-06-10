import type { Artifact } from "./types.js";

// Pinning exempts an Artifact from Auto Deletion (ADR 0048): while pinned_at is
// set, the stored expires_at is retained but not enforced by sweeps or reads.
export function isArtifactExpired(artifact: Pick<Artifact, "expires_at" | "pinned_at">, nowMs: number): boolean {
  return !artifact.pinned_at && new Date(artifact.expires_at).getTime() <= nowMs;
}
