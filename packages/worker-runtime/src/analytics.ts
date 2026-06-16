export type AnalyticsEngineDataPoint = {
  indexes?: (ArrayBuffer | string | null)[];
  doubles?: number[];
  blobs?: (ArrayBuffer | string | null)[];
};

export type AnalyticsEngineDataset = {
  writeDataPoint(event?: AnalyticsEngineDataPoint): void;
};

export type ArtifactEventKind = "publish" | "read";

export type FunnelEventKind =
  | "prompt_copied"
  | "ephemeral_provision_started"
  | "ephemeral_workspace_created"
  | "ephemeral_provision_rate_limited"
  | "ephemeral_provision_unavailable"
  | "ephemeral_publish_created"
  | "ephemeral_link_opened"
  | "link_claimed";

export type ArtifactEvent = {
  kind: ArtifactEventKind;
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  bytes?: number;
  // publish: whether the revision is on the ephemeral tier. read: GET vs HEAD method.
  detail?: string;
};

export type FunnelEvent = {
  kind: FunnelEventKind;
  surface: "apex" | "api" | "web" | "cli";
  claimCode?: string | undefined;
  workspaceId?: string | undefined;
  artifactId?: string | undefined;
  claimTokenId?: string | undefined;
  promptVariant?: string | undefined;
  status?: string | undefined;
  artifactCount?: number | undefined;
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

export function funnelEventDataPoint(event: FunnelEvent): AnalyticsEngineDataPoint {
  const count = 1;
  const artifactCount = Number.isFinite(event.artifactCount) ? (event.artifactCount as number) : 0;
  return {
    indexes: [event.claimCode ?? event.workspaceId ?? event.kind],
    blobs: [
      event.kind,
      event.surface,
      event.claimCode ?? "",
      event.workspaceId ?? "",
      event.artifactId ?? "",
      event.claimTokenId ?? "",
      event.promptVariant ?? "",
      event.status ?? "",
    ],
    doubles: [count, artifactCount],
  };
}

// Fire-and-forget. Analytics must never break a publish or a read, so a missing
// binding is a silent no-op and any write failure is swallowed.
export function writeArtifactEvent(ae: AnalyticsEngineDataset | undefined, event: ArtifactEvent): void {
  writeAnalyticsEvent(ae, artifactEventDataPoint(event));
}

export function writeFunnelEvent(ae: AnalyticsEngineDataset | undefined, event: FunnelEvent): void {
  writeAnalyticsEvent(ae, funnelEventDataPoint(event));
}

function writeAnalyticsEvent(ae: AnalyticsEngineDataset | undefined, dataPoint: AnalyticsEngineDataPoint): void {
  if (!ae) {
    return;
  }
  try {
    ae.writeDataPoint(dataPoint);
  } catch {
    // Telemetry is best-effort; never surface to the caller.
  }
}
