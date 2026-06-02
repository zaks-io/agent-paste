import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { claimEphemeralFn, LOCAL_TURNSTILE_BYPASS_TOKEN } from "../server/web-mutations";

const loadClaimPageFn = createServerFn({ method: "GET" }).handler(async () => {
  const { turnstileSiteKey } = await import("../server/turnstile");
  return { turnstileSiteKey: turnstileSiteKey() };
});

export const Route = createFileRoute("/_authed/claim")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  loader: () => loadClaimPageFn(),
  head: ({ matches }) =>
    dashboardPageMeta(
      "Claim Ephemeral Workspace",
      "Redeem a one-time Claim Token to keep agent-published content in your workspace.",
      "/claim",
      matches,
    ),
  component: ClaimPage,
});

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

function ClaimPage() {
  const { token } = Route.useSearch();
  const { turnstileSiteKey: siteKey } = Route.useLoaderData();
  const navigate = useNavigate();
  const [claimToken, setClaimToken] = useState(token);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(siteKey ? null : LOCAL_TURNSTILE_BYPASS_TOKEN);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [successArtifactCount, setSuccessArtifactCount] = useState<number | null>(null);

  useEffect(() => {
    setClaimToken(token);
  }, [token]);

  useEffect(() => {
    if (!siteKey) {
      return;
    }
    const scriptId = "cf-turnstile-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    let widgetId: string | undefined;
    const mount = () => {
      if (!window.turnstile) {
        window.setTimeout(mount, 50);
        return;
      }
      const container = document.getElementById("claim-turnstile");
      if (!container || container.childElementCount > 0) {
        return;
      }
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (value) => setTurnstileToken(value),
        "error-callback": () => setTurnstileToken(null),
      });
    };
    mount();

    return () => {
      if (widgetId && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
    };
  }, [siteKey]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!turnstileToken) {
      setError({ message: "Complete the Turnstile check before claiming." });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await claimEphemeralFn({
        data: { claim_token: claimToken.trim(), turnstile_token: turnstileToken },
      });
      if (result.error) {
        setError({
          message: result.error.message,
          ...(result.error.requestId ? { requestId: result.error.requestId } : {}),
        });
        return;
      }
      setSuccessArtifactCount(result.data.artifact_ids.length);
      window.setTimeout(() => {
        void navigate({ to: "/artifacts" });
      }, 1200);
    } catch {
      setError({ message: "Claim request failed. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Claim workspace"
        description="Redeem a one-time Claim Token from agent-paste publish output to keep ephemeral content in your Personal Workspace."
      />
      {error ? <ErrorBanner title="Claim failed" message={error.message} requestId={error.requestId} /> : null}
      {successArtifactCount !== null ? (
        <Card>
          <CardHeader
            title="Claim succeeded"
            subtitle={`Reparented ${successArtifactCount} artifact${successArtifactCount === 1 ? "" : "s"} into your workspace.`}
          />
        </Card>
      ) : (
        <Card>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <label className="grid gap-2 text-[13px]" htmlFor="claim-token-input">
              <span className="text-[hsl(var(--muted))]">Claim token</span>
              <Input
                id="claim-token-input"
                value={claimToken}
                onChange={(event) => setClaimToken(event.target.value)}
                placeholder="ap_ct_preview_..."
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            {siteKey ? <div id="claim-turnstile" className="min-h-[65px]" /> : null}
            <Button type="submit" disabled={submitting || !claimToken.trim() || !turnstileToken}>
              {submitting ? "Claiming…" : "Claim content"}
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}
