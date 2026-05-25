import type { LockdownDetail } from "@agent-paste/contracts";
import { useState } from "react";
import { formatRelativeTime } from "../../lib/format";
import type { ApiErrorInfo } from "../../server/api-client";
import { liftLockdownFn } from "../../server/web-mutations";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Identifier } from "../ui/Identifier";
import { Table, TBody, TD, TH, THead, TR } from "../ui/Table";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  lockdowns: readonly LockdownDetail[];
  error: ApiErrorInfo | null;
  onLift: () => void;
};

export function LockdownList({ lockdowns, error, onLift }: Props) {
  const { push } = useToast();
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  async function handleLift(scope: string, targetId: string) {
    const key = `${scope}:${targetId}`;
    setPendingIds((current) => new Set(current).add(key));
    try {
      const result = await liftLockdownFn({ data: { scope, target_id: targetId } });
      if (result.error) {
        push(errorToast("Couldn't lift lockdown", result.error));
        return;
      }
      push({ tone: "success", title: "Lockdown lifted", message: "Platform lockdown removed." });
      onLift();
    } catch (error) {
      push({
        tone: "error",
        title: "Couldn't lift lockdown",
        message: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  const activeLockdowns = lockdowns.filter((ld) => ld.lifted_at === null);

  return (
    <Card>
      <CardHeader
        title="Active lockdowns"
        subtitle="Effective platform lockdowns currently enforced by API and content denylist paths."
      />
      {error ? (
        <ErrorBanner title="Couldn't load lockdowns" message={error.message} requestId={error.requestId} />
      ) : activeLockdowns.length === 0 ? (
        <p className="text-[13px] text-[hsl(var(--muted))]">No active lockdowns.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Scope</TH>
              <TH>Target</TH>
              <TH>Reason</TH>
              <TH>Set by</TH>
              <TH>Set at</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {activeLockdowns.map((ld) => (
              <TR key={`${ld.scope}:${ld.target_id}`}>
                <TD className="text-[13px]">
                  <Badge tone={ld.scope === "workspace" ? "warning" : "destructive"}>{ld.scope}</Badge>
                </TD>
                <TD>
                  <Identifier value={ld.target_id} />
                </TD>
                <TD className="text-[13px]">{ld.reason_code}</TD>
                <TD className="text-[13px]">{ld.set_by}</TD>
                <TD className="font-mono text-[12px]" title={ld.set_at}>
                  {formatRelativeTime(ld.set_at)}
                </TD>
                <TD className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleLift(ld.scope, ld.target_id)}
                    disabled={pendingIds.has(`${ld.scope}:${ld.target_id}`)}
                    loading={pendingIds.has(`${ld.scope}:${ld.target_id}`)}
                  >
                    Lift
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
