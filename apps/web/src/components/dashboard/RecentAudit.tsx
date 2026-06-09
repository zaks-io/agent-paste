import type { WebAuditRow } from "@agent-paste/contracts";
import { SectionLabel } from "@agent-paste/ui";
import { Link } from "@tanstack/react-router";
import type { ApiErrorInfo } from "../../lib/api-error";
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
      <SectionLabel
        className="mb-4"
        action={
          <Link to="/audit" className="font-mono text-mono-sm uppercase tracking-wider text-subtle hover:text-accent">
            Audit log →
          </Link>
        }
      >
        Activity
      </SectionLabel>
      {error ? (
        <ErrorBanner title="Couldn't load activity" message={error.message} requestId={error.requestId} />
      ) : rows.length === 0 ? (
        <p className="border-t border-rule pt-4 text-sm text-subtle">No activity yet.</p>
      ) : (
        <ul className="border-t border-rule font-mono text-xs">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 border-b border-rule py-2 pl-3 pr-3">
              <span className="text-foreground">{row.action}</span>
              <span className="truncate text-subtle">{row.actor}</span>
              <span className="ml-auto shrink-0 text-faint">
                <RelativeTime value={row.time} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
