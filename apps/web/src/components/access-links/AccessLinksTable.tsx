import type { WebAccessLinkRow } from "@agent-paste/contracts";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { accessLinkState } from "../../lib/access-link-state";
import { useHydrated } from "../../lib/use-hydrated";
import { mintAccessLinkFn, revokeAccessLinkFn } from "../../rpc/web-mutations";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable } from "../ui/DataTable";
import { Identifier } from "../ui/Identifier";
import { OptionalRelativeTime } from "../ui/OptionalRelativeTime";
import { RelativeTime } from "../ui/RelativeTime";
import { RevokedActionPlaceholder } from "../ui/RevokedActionPlaceholder";
import { StateBadge } from "../ui/StateBadge";
import { TBody, TD, TH, THead, TR } from "../ui/Table";
import { errorToast, useToast } from "../ui/toast-context";
import { MintedUrlReveal } from "./MintedUrlReveal";

type Props = {
  rows: readonly WebAccessLinkRow[];
  /** Show the Artifact column with a deep-link — used on the workspace-wide page. */
  showArtifact?: boolean;
  /** Access Link Lockdown blocks minting full URLs; disable Copy URL when engaged. */
  locked?: boolean;
  onChanged: () => void | Promise<void>;
};

const TYPE_TONE = { share: "info", revision: "accent" } as const;

export function AccessLinksTable({ rows, showArtifact = false, locked = false, onChanged }: Props) {
  const { push } = useToast();
  const hydrated = useHydrated();
  const [mintingId, setMintingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [mintedUrls, setMintedUrls] = useState<Record<string, string>>({});

  const busy = mintingId !== null || revokingId !== null;

  async function onMint(row: WebAccessLinkRow) {
    if (busy) return;
    setMintingId(row.id);
    try {
      const result = await mintAccessLinkFn({ data: { accessLinkId: row.id } });
      if (result.error) {
        push(errorToast("Couldn't mint URL", result.error));
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.url);
      } catch {
        // clipboard may be unavailable; the reveal still shows the URL.
      }
      setMintedUrls((current) => ({ ...current, [row.id]: result.data.url }));
    } finally {
      setMintingId(null);
    }
  }

  async function onRevoke(row: WebAccessLinkRow) {
    if (busy) return;
    setRevokingId(row.id);
    try {
      const result = await revokeAccessLinkFn({ data: { accessLinkId: row.id } });
      if (result.error) {
        push(errorToast("Couldn't revoke link", result.error));
        return;
      }
      setMintedUrls((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      push({ tone: "success", title: "Access Link revoked", message: "It no longer grants access." });
      await onChanged();
    } finally {
      setRevokingId(null);
    }
  }

  function dismissMinted(id: string) {
    setMintedUrls((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const columnCount = showArtifact ? 6 : 5;

  return (
    <DataTable>
      <THead>
        <TR>
          <TH>Type</TH>
          {showArtifact ? <TH>Artifact</TH> : null}
          <TH>Pinned revision</TH>
          <TH>Created</TH>
          <TH>Expires</TH>
          <TH>State</TH>
          <TH className="text-right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const state = accessLinkState(row, hydrated);
          const minted = mintedUrls[row.id];
          return (
            <Fragment key={row.id}>
              <TR>
                <TD>
                  <Badge tone={TYPE_TONE[row.type]}>{row.type}</Badge>
                </TD>
                {showArtifact ? (
                  <TD>
                    <Link
                      to="/artifacts/$artifactId"
                      params={{ artifactId: row.artifact_id }}
                      className="font-mono text-[12px] text-[hsl(var(--subtle))] hover:text-[hsl(var(--accent))]"
                    >
                      {row.artifact_id}
                    </Link>
                  </TD>
                ) : null}
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  {row.revision_id ? <Identifier value={row.revision_id} /> : "latest"}
                </TD>
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  <RelativeTime value={row.created_at} />
                </TD>
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  <OptionalRelativeTime value={row.expires_at} />
                </TD>
                <TD>
                  <StateBadge state={state} />
                </TD>
                <TD className="text-right">
                  {row.revoked ? (
                    <RevokedActionPlaceholder />
                  ) : (
                    <div className="inline-flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={mintingId === row.id}
                        disabled={busy || locked}
                        title={locked ? "Lift Access Link Lockdown to mint a URL." : undefined}
                        onClick={() => onMint(row)}
                      >
                        Copy URL
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={revokingId === row.id}
                        disabled={busy}
                        onClick={() => onRevoke(row)}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
              {minted ? (
                <TR>
                  <TD colSpan={columnCount} className="bg-[hsl(var(--surface-2))]">
                    <MintedUrlReveal url={minted} onDismiss={() => dismissMinted(row.id)} />
                  </TD>
                </TR>
              ) : null}
            </Fragment>
          );
        })}
      </TBody>
    </DataTable>
  );
}
