import type { RevisionSummary } from "@agent-paste/contracts";
import { Button, Card, CardHeader } from "@agent-paste/ui";
import { useState } from "react";
import { createAccessLinkFn } from "../../rpc/web-mutations";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  artifactId: string;
  revisions: readonly RevisionSummary[];
  latestRevisionId: string | null;
  /** Access Link Lockdown blocks creating new links — disable the panel when engaged. */
  locked: boolean;
  onChanged: () => void | Promise<void>;
};

export function CreateAccessLinkPanel({ artifactId, revisions, latestRevisionId, locked, onChanged }: Props) {
  const { push } = useToast();
  const [pending, setPending] = useState<"share" | "revision" | null>(null);
  // Default to the latest revision only when it is actually in the rendered options;
  // otherwise the select shows option 0 selected while state holds a hidden id.
  const defaultRevisionId =
    (latestRevisionId && revisions.some((revision) => revision.revision_id === latestRevisionId)
      ? latestRevisionId
      : revisions[0]?.revision_id) ?? "";
  const [revisionId, setRevisionId] = useState<string>(defaultRevisionId);

  async function create(type: "share" | "revision", revision?: string) {
    if (pending || locked) return;
    setPending(type);
    try {
      const result = await createAccessLinkFn({
        data: { artifactId, type, ...(revision ? { revision_id: revision } : {}) },
      });
      if (result.error) {
        push(errorToast(`Couldn't create ${type} link`, result.error));
        return;
      }
      push({
        tone: "success",
        title: type === "share" ? "Share Link created" : "Revision Link created",
        message: "Use Copy URL to mint a shareable URL.",
      });
      await onChanged();
    } finally {
      setPending(null);
    }
  }

  const canCreateRevision = revisions.length > 0 && revisionId.length > 0;

  return (
    <Card>
      <CardHeader
        title="Create an Access Link"
        subtitle={
          locked
            ? "Access Link Lockdown is engaged — creating new links is blocked until it is lifted."
            : "Share Links follow the latest revision. Revision Links pin one specific revision."
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <span className="text-[12px] text-[hsl(var(--muted))]">Share Link</span>
          <Button
            variant="primary"
            loading={pending === "share"}
            disabled={locked || pending !== null}
            onClick={() => create("share")}
          >
            Create Share Link
          </Button>
        </div>
        <div className="grid content-start gap-2">
          <span className="text-[12px] text-[hsl(var(--muted))]">Revision Link</span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Revision to pin"
              value={revisionId}
              disabled={locked || revisions.length === 0 || pending !== null}
              onChange={(event) => setRevisionId(event.target.value)}
              className="h-[35px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[hsl(var(--rule-strong))] bg-[hsl(var(--background))] px-3 font-mono text-[12.5px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--accent))] focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            >
              {revisions.length === 0 ? (
                <option value="">No revisions</option>
              ) : (
                revisions.map((revision) => (
                  <option key={revision.revision_id} value={revision.revision_id}>
                    {revisionLabel(revision, latestRevisionId)}
                  </option>
                ))
              )}
            </select>
            <Button
              variant="secondary"
              loading={pending === "revision"}
              disabled={locked || !canCreateRevision || pending !== null}
              onClick={() => create("revision", revisionId)}
            >
              Create
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function revisionLabel(revision: RevisionSummary, latestRevisionId: string | null): string {
  const number = revision.revision_number !== null ? `#${revision.revision_number}` : revision.revision_id;
  const latest = revision.revision_id === latestRevisionId ? " (latest)" : "";
  return `${number}${latest}`;
}
