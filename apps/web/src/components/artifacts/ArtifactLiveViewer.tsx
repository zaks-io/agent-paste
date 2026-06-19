import type { LiveUpdatePointer, WebArtifactDetailResponse } from "@agent-paste/contracts";
import { Badge, Card } from "@agent-paste/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { connectLiveUpdates } from "../../lib/live-updates";
import { queryKeys } from "../../lib/queries";
import { EmptyState } from "../ui/EmptyState";
import { ArtifactViewerIframe } from "./ArtifactViewerIframe";

/**
 * The live artifact viewer iframe shared by the member console
 * (`/artifacts/$id`) and the clean member viewer (`/v/$id`). It owns the
 * live-update subscription and the lockdown/revoked visibility derivation so
 * both routes render an identical viewer with one implementation.
 */
export function ArtifactLiveViewer({
  artifactId,
  artifact,
  chrome = true,
}: {
  artifactId: string;
  artifact: WebArtifactDetailResponse | null;
  chrome?: boolean;
}) {
  const queryClient = useQueryClient();
  const iframeSrc = useArtifactViewerSrc(artifactId, artifact, queryClient);

  if (!iframeSrc) {
    return <EmptyState title="No published viewer." body="This artifact has no live revision to display right now." />;
  }

  const frame = <ArtifactViewerIframe src={iframeSrc} />;

  if (!chrome) {
    return <div className="h-full w-full bg-background">{frame}</div>;
  }

  return (
    <Card elevated flush className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">Published viewer</span>
          <span className="text-xs text-subtle">live on each revision</span>
        </div>
        <Badge tone="success" dot pulse>
          Live
        </Badge>
      </div>
      <div className="h-[min(70vh,720px)] bg-background">{frame}</div>
    </Card>
  );
}

/**
 * Keeps the most recent successfully-loaded artifact so a background metadata
 * refetch that races a transient timeout does not blank a working viewer.
 */
export function useLastGoodArtifact(
  artifactId: string,
  current: WebArtifactDetailResponse | null | undefined,
): WebArtifactDetailResponse | null {
  const [lastGoodArtifact, setLastGoodArtifact] = useState<{
    artifactId: string;
    artifact: WebArtifactDetailResponse;
  } | null>(null);

  useEffect(() => {
    if (current) {
      setLastGoodArtifact({ artifactId, artifact: current });
    }
  }, [artifactId, current]);

  return current ?? (lastGoodArtifact?.artifactId === artifactId ? lastGoodArtifact.artifact : null);
}

function useArtifactViewerSrc(
  artifactId: string,
  artifact: WebArtifactDetailResponse | null,
  queryClient: QueryClient,
): string | null {
  const [liveState, setLiveState] = useState<{
    artifactId: string;
    pointer: LiveUpdatePointer | null;
    revoked: boolean;
  }>(() => ({ artifactId, pointer: null, revoked: false }));

  useEffect(() => {
    setLiveState((current) =>
      current.artifactId === artifactId ? current : { artifactId, pointer: null, revoked: false },
    );
  }, [artifactId]);

  useEffect(() => {
    setLiveState((current) => {
      if (
        current.artifactId !== artifactId ||
        !current.pointer ||
        !artifact?.latest_revision_id ||
        artifact.latest_revision_id === current.pointer.revision_id
      ) {
        return current;
      }
      return { ...current, pointer: null };
    });
  }, [artifactId, artifact?.latest_revision_id]);

  useEffect(() => {
    if (!artifact) {
      return;
    }
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifactId) });
    };
    const connection = connectLiveUpdates({
      url: `/api/live/artifacts/${encodeURIComponent(artifactId)}`,
      // A publish event refetches the whole artifact, so the iframe and every
      // other field update together. A fresh revision also clears prior revoked state.
      onPointer: (pointer: LiveUpdatePointer) => {
        setLiveState({ artifactId, pointer, revoked: false });
        invalidate();
      },
      onRevoked: () => {
        setLiveState({ artifactId, pointer: null, revoked: true });
        invalidate();
      },
    });
    return () => connection.close();
  }, [artifact, artifactId, queryClient]);

  const current = liveState.artifactId === artifactId ? liveState : { pointer: null, revoked: false };
  // The API leaves `viewer` populated on lockdowns; derive visibility from both
  // the content pointer and the edge-enforced lockdown signals.
  return artifact && !artifact.lockdown && !current.revoked
    ? (current.pointer?.iframe_src ?? artifact.viewer?.iframe_src ?? null)
    : null;
}
