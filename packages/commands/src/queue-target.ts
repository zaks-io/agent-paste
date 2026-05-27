export type RevisionQueueTargetState = {
  revisionStatus: string;
  artifactStatus: string;
  bundleStatus?: string | null;
};

export type SkipRevisionQueueWorkReason = "revision_retained" | "artifact_deleted" | "bundle_ready" | "bundle_disabled";

export function shouldSkipRevisionQueueWork(state: RevisionQueueTargetState): SkipRevisionQueueWorkReason | null {
  if (state.revisionStatus === "retained") {
    return "revision_retained";
  }
  if (state.artifactStatus === "deleted" || state.artifactStatus === "expired") {
    return "artifact_deleted";
  }
  if (state.bundleStatus === "ready") {
    return "bundle_ready";
  }
  if (state.bundleStatus === "disabled") {
    return "bundle_disabled";
  }
  return null;
}
