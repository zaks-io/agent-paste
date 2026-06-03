import type { WebArtifactRow } from "@agent-paste/contracts";
import { Link } from "@tanstack/react-router";
import { artifactStatusTone } from "../../lib/artifact-status";
import type { ApiErrorInfo } from "../../server/api-client";
import { Badge } from "../ui/Badge";
import { SectionLabel } from "../ui/Card";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Identifier } from "../ui/Identifier";
import { RelativeTime } from "../ui/RelativeTime";

type Props = {
  rows: readonly WebArtifactRow[];
  error: ApiErrorInfo | null;
};

/* Ledger rows, not a card. Hairline-ruled, mono data, status as a dot+label. */
export function RecentArtifacts({ rows, error }: Props) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <SectionLabel className="flex-1">Recent</SectionLabel>
        <Link
          to="/artifacts"
          className="shrink-0 pl-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--subtle))] hover:text-[hsl(var(--accent))]"
        >
          All artifacts →
        </Link>
      </div>
      {error ? (
        <ErrorBanner title="Couldn't load artifacts" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="border-t border-[hsl(var(--rule))] pt-4 text-[13px] text-[hsl(var(--subtle))]">
          No artifacts published yet.
        </p>
      ) : (
        <ul className="border-t border-[hsl(var(--rule))]">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-[hsl(var(--rule))]">
              <Link
                to="/artifacts/$artifactId"
                params={{ artifactId: row.id }}
                className="group grid grid-cols-[1fr_auto] items-center gap-4 py-3 transition-colors hover:bg-[hsl(var(--surface-2))]"
              >
                <div className="min-w-0 pl-3">
                  <div className="truncate text-[14px] font-medium text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--accent))]">
                    {row.title || "Untitled"}
                  </div>
                  <div className="mt-0.5">
                    <Identifier value={row.id} />
                  </div>
                </div>
                <div className="flex items-center gap-6 pr-3">
                  <Badge tone={artifactStatusTone(row.status)} dot>
                    {row.status}
                  </Badge>
                  <span className="hidden w-[90px] text-right font-mono text-[11.5px] text-[hsl(var(--subtle))] sm:block">
                    {row.last_published_at ? <RelativeTime value={row.last_published_at} /> : "—"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
