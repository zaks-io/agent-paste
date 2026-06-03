import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import {
  claimRedemptionErrorMessage,
  claimTokenFromLocationHash,
  clearClaimTokenFromLocation,
  consumePendingClaimToken,
} from "../lib/claim-redemption";
import { dashboardPageMeta } from "../lib/page-meta";
import { LOCAL_TURNSTILE_BYPASS_TOKEN } from "../lib/turnstile-constants";
import { loadClaimPageFn } from "../rpc/web-loaders";
import { claimEphemeralFn } from "../rpc/web-mutations";

export const Route = createFileRoute("/_authed/claim")({
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

function resolveInitialClaimToken(): string {
  const fromHash = claimTokenFromLocationHash();
  if (fromHash) {
    clearClaimTokenFromLocation();
    return fromHash;
  }
  return consumePendingClaimToken() ?? "";
}

function claimSuccessPath(artifactIds: string[]): string {
  const [artifactId] = artifactIds;
  if (artifactIds.length === 1 && artifactId) {
    return `/artifacts/${encodeURIComponent(artifactId)}`;
  }
  return "/artifacts";
}

function ClaimPage() {
  const { turnstileSiteKey: siteKey } = Route.useLoaderData();
  const navigate = useNavigate();
  const [claimToken, setClaimToken] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(siteKey ? null : LOCAL_TURNSTILE_BYPASS_TOKEN);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [successArtifactCount, setSuccessArtifactCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    setClaimToken(resolveInitialClaimToken());
  }, []);

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
          message: claimRedemptionErrorMessage(result.error),
          ...(result.error.requestId ? { requestId: result.error.requestId } : {}),
        });
        return;
      }
      const artifactIds = result.data.artifact_ids;
      setSuccessArtifactCount(artifactIds.length);
      const destination = claimSuccessPath(artifactIds);
      window.setTimeout(() => {
        void navigate({ to: destination });
      }, 1200);
    } catch {
      setError({ message: claimRedemptionErrorMessage({ code: "network_error", status: 0, message: "" }) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ephemeral"
        title="Claim workspace"
        description="Redeem a one-time Claim Token from agent-paste publish output to keep ephemeral content in your Personal Workspace."
      />
      {error ? <ErrorBanner title="Claim failed" message={error.message} requestId={error.requestId} /> : null}
      {successArtifactCount !== null ? (
        <Card className="border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent-tint))]">
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
