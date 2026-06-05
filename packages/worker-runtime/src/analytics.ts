export type AnalyticsEngineDataPoint = {
  indexes?: (ArrayBuffer | string | null)[];
  doubles?: number[];
  blobs?: (ArrayBuffer | string | null)[];
};

export type AnalyticsEngineDataset = {
  writeDataPoint(event?: AnalyticsEngineDataPoint): void;
};

export type ArtifactEventKind = "publish" | "read";

export type ArtifactEvent = {
  kind: ArtifactEventKind;
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  bytes?: number;
  // publish: whether the revision is on the ephemeral tier. read: GET vs HEAD method.
  detail?: string;
};

// blob1 carries the event kind so a single dataset answers both publish and read
// queries (`SELECT ... WHERE blob1 = 'publish'`). workspaceId is the index because
// per-workspace rollups are the access pattern we expect; AE allows one index.
export function artifactEventDataPoint(event: ArtifactEvent): AnalyticsEngineDataPoint {
  return {
    indexes: [event.workspaceId],
    blobs: [event.kind, event.artifactId, event.revisionId, event.detail ?? ""],
    doubles: [Number.isFinite(event.bytes) ? (event.bytes as number) : 0],
  };
}

// Fire-and-forget. Analytics must never break a publish or a read, so a missing
// binding is a silent no-op and any write failure is swallowed.
export function writeArtifactEvent(ae: AnalyticsEngineDataset | undefined, event: ArtifactEvent): void {
  if (!ae) {
    return;
  }
  try {
    ae.writeDataPoint(artifactEventDataPoint(event));
  } catch {
    // Telemetry is best-effort; never surface to the caller.
  }
}
