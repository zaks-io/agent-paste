import type { WebArtifactStatus } from "@agent-paste/contracts";
import type { BadgeTone } from "@agent-paste/ui";

const TONE_BY_STATUS: Record<WebArtifactStatus, BadgeTone> = {
  Published: "success",
  Expired: "warning",
  Deleted: "destructive",
};

export function artifactStatusTone(status: WebArtifactStatus): BadgeTone {
  return TONE_BY_STATUS[status];
}
