import type { WebApiKeyRow } from "@agent-paste/contracts";
import { Button, TBody, TD, TH, THead, TR } from "@agent-paste/ui";
import { useState } from "react";
import { revocableEntityState } from "../../lib/revocable-entity-state";
import { useHydrated } from "../../lib/use-hydrated";
import { revokeKeyFn } from "../../rpc/web-mutations";
import { DataTable } from "../ui/DataTable";
import { Identifier } from "../ui/Identifier";
import { OptionalRelativeTime } from "../ui/OptionalRelativeTime";
import { RevokedActionPlaceholder } from "../ui/RevokedActionPlaceholder";
import { StateBadge } from "../ui/StateBadge";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  rows: readonly WebApiKeyRow[];
  onRevoked: () => void | Promise<void>;
};

export function KeysTable({ rows, onRevoked }: Props) {
  const { push } = useToast();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const hydrated = useHydrated();

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
    <DataTable>
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
          const state = revocableEntityState(row, hydrated);
          return (
            <TR key={row.id}>
              <TD className="font-medium">{row.name}</TD>
              <TD>
                <Identifier value={row.public_id} />
              </TD>
              <TD className="text-[hsl(var(--muted))]">{row.scopes.join(", ")}</TD>
              <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                <OptionalRelativeTime value={row.last_used_at} />
              </TD>
              <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                <OptionalRelativeTime value={row.expires_at} />
              </TD>
              <TD>
                <StateBadge state={state} />
              </TD>
              <TD className="text-right">
                {row.revoked ? (
                  <RevokedActionPlaceholder placeholder="-" />
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
    </DataTable>
  );
}
