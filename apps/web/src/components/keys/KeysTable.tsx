import type { WebApiKeyRow } from "@agent-paste/contracts";
import { useState } from "react";
import { formatRelativeTime } from "../../lib/format";
import { revokeKeyFn } from "../../server/web-mutations";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Identifier } from "../ui/Identifier";
import { Table, TBody, TD, TH, THead, TR } from "../ui/Table";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  rows: readonly WebApiKeyRow[];
  onRevoked: () => void | Promise<void>;
};

export function KeysTable({ rows, onRevoked }: Props) {
  const { push } = useToast();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function onRevoke(row: WebApiKeyRow) {
    if (revokingId) return;
    setRevokingId(row.id);
    try {
      const result = await revokeKeyFn({ data: { apiKeyId: row.id } });
      if (result.error) {
        push(errorToast("Couldn't revoke key", result.error));
        return;
      }
      push({ tone: "success", title: "Key revoked", message: `"${row.name}" can no longer publish.` });
      await onRevoked();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>Public ID</TH>
          <TH>Scopes</TH>
          <TH>Last used</TH>
          <TH>Expires</TH>
          <TH>State</TH>
          <TH className="text-right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const state = keyState(row);
          return (
            <TR key={row.id}>
              <TD className="font-medium">{row.name}</TD>
              <TD>
                <Identifier value={row.public_id} />
              </TD>
              <TD className="text-[hsl(var(--muted))]">{row.scopes.join(", ")}</TD>
              <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                {row.last_used_at ? formatRelativeTime(row.last_used_at) : "never"}
              </TD>
              <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                {row.expires_at ? formatRelativeTime(row.expires_at) : "never"}
              </TD>
              <TD>
                <Badge tone={state.tone}>{state.label}</Badge>
              </TD>
              <TD className="text-right">
                {row.revoked ? (
                  <span className="text-[hsl(var(--subtle))]">-</span>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={revokingId === row.id}
                    disabled={revokingId !== null}
                    onClick={() => onRevoke(row)}
                  >
                    Revoke
                  </Button>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function keyState(row: WebApiKeyRow): { label: string; tone: "success" | "warning" | "destructive" } {
  if (row.revoked) {
    return { label: "Revoked", tone: "destructive" };
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { label: "Expired", tone: "warning" };
  }
  return { label: "Active", tone: "success" };
}
