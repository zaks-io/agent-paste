import type { WebApiKeyListResponse } from "@agent-paste/contracts";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { KeyCreateForm } from "../components/keys/KeyCreateForm";
import { KeysTable } from "../components/keys/KeysTable";
import { NewKeySecretCard } from "../components/keys/NewKeySecretCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { listKeysFn } from "../rpc/web-loaders";

export const Route = createFileRoute("/_authed/keys")({
  loader: () => listKeysFn(),
  head: ({ matches }) =>
    dashboardPageMeta("API Keys", "Manage API keys for CI, headless use, and workspace automation.", "/keys", matches),
  component: KeysPage,
});

function KeysPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const rows: WebApiKeyListResponse["items"] = result.data?.items ?? [];

  const refresh = useCallback(() => router.invalidate(), [router]);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="API Keys"
        description={
          <>
            Keys for CI and headless use. The CLI provisions its own when you run{" "}
            <code className="font-mono text-[12px]">npx @zaks-io/agent-paste login</code>; secrets are shown once on
            creation.
          </>
        }
      />
      <div className="grid gap-6">
        {newSecret ? <NewKeySecretCard secret={newSecret} onDismiss={() => setNewSecret(null)} /> : null}
        <KeyCreateForm onCreated={refresh} onSecret={setNewSecret} />
        {result.error ? (
          <ErrorBanner title="Couldn't load keys" message={result.error.message} requestId={result.error.requestId} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No API keys yet."
            body={
              <>
                The CLI provisions its own key when you run{" "}
                <code className="font-mono text-[12px]">npx @zaks-io/agent-paste login</code>. Create one here for CI or
                headless use.
              </>
            }
          />
        ) : (
          <KeysTable rows={rows} onRevoked={refresh} />
        )}
      </div>
    </>
  );
}
