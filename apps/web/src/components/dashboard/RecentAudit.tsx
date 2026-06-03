import type { WebAuditRow } from "@agent-paste/contracts";
import { Link } from "@tanstack/react-router";
import type { ApiErrorInfo } from "../../lib/api-error";
import { SectionLabel } from "../ui/Card";
import { ErrorBanner } from "../ui/ErrorBanner";
import { RelativeTime } from "../ui/RelativeTime";

type Props = {
  rows: readonly WebAuditRow[];
  error: ApiErrorInfo | null;
};

/* The quiet ledger of activity. Mono throughout — an instrument log, demoted. */
export function RecentAudit({ rows, error }: Props) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <SectionLabel className="flex-1">Activity</SectionLabel>
        <Link
          to="/audit"
          className="shrink-0 pl-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--subtle))] hover:text-[hsl(var(--accent))]"
        >
          Audit log →
        </Link>
      </div>
      {error ? (
        <ErrorBanner title="Couldn't load activity" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="border-t border-[hsl(var(--rule))] pt-4 text-[13px] text-[hsl(var(--subtle))]">
          No activity yet.
        </p>
      ) : (
        <ul className="border-t border-[hsl(var(--rule))] font-mono text-[12px]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 border-b border-[hsl(var(--rule))] py-2.5 pl-3 pr-3">
              <span className="text-[hsl(var(--foreground))]">{row.action}</span>
              <span className="truncate text-[hsl(var(--subtle))]">{row.actor}</span>
              <span className="ml-auto shrink-0 text-[hsl(var(--faint))]">
                <RelativeTime value={row.time} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
