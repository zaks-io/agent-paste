import type { WebArtifactRow } from "@agent-paste/contracts";
import { Badge, SectionLabel } from "@agent-paste/ui";
import { Link } from "@tanstack/react-router";
import type { ApiErrorInfo } from "../../lib/api-error";
import { artifactStatusTone } from "../../lib/artifact-status";
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
          className="shrink-0 pl-4 font-mono text-mono-sm uppercase tracking-wider text-subtle hover:text-accent"
        >
          All artifacts →
        </Link>
      </div>
      {error ? (
        <ErrorBanner title="Couldn't load artifacts" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="border-t border-rule pt-4 text-sm text-subtle">No artifacts published yet.</p>
      ) : (
        <ul className="border-t border-rule">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-rule">
              <Link
                to="/artifacts/$artifactId"
                params={{ artifactId: row.id }}
                className="group grid grid-cols-[1fr_auto] items-center gap-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 pl-3">
                  <div className="truncate text-base font-medium text-foreground group-hover:text-accent">
                    {row.title || "Untitled"}
                  </div>
                  <div className="mt-1">
                    <Identifier value={row.id} />
                  </div>
                </div>
                <div className="flex items-center gap-6 pr-3">
                  <Badge tone={artifactStatusTone(row.status)} dot>
                    {row.status}
                  </Badge>
                  <span className="hidden w-[90px] text-right font-mono text-mono-sm text-subtle sm:block">
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
