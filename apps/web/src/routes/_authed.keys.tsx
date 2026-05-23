import type { WebApiKeyListResponse } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Identifier } from "../components/ui/Identifier";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { formatRelativeTime } from "../lib/format";
import { apiFetchOrEmpty } from "../server/api-client";

const listKeysFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) return { data: null, empty: true, error: null };
  return apiFetchOrEmpty<WebApiKeyListResponse>("/v1/web/keys", {
    accessToken: auth.accessToken,
  });
});

export const Route = createFileRoute("/_authed/keys")({
  loader: () => listKeysFn(),
  component: KeysPage,
});

function KeysPage() {
  const result = Route.useLoaderData();
  const rows: WebApiKeyListResponse["items"] = result.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Manage workspace API keys. Secrets are shown once on creation."
        actions={<Button>Create key</Button>}
      />
      {result.error ? (
        <ErrorBanner title="Couldn't load keys" message={result.error.message} requestId={result.error.requestId} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No API keys yet."
          body="You'll need a key to publish from the CLI."
          action={<Button>Create your first key</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Public ID</TH>
              <TH>Scopes</TH>
              <TH>Last used</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-medium">{row.name}</TD>
                <TD>
                  <Identifier value={row.public_id} />
                </TD>
                <TD className="text-[hsl(var(--muted))]">{row.scopes.join(", ")}</TD>
                <TD className="text-[hsl(var(--muted))] font-mono text-[12px]">
                  {row.last_used_at ? formatRelativeTime(row.last_used_at) : "never"}
                </TD>
                <TD>
                  <Badge tone={row.revoked ? "destructive" : "success"}>{row.revoked ? "Revoked" : "Active"}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
