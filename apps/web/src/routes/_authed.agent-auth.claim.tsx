import { Button, Card, CardHeader } from "@agent-paste/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { dashboardPageMeta } from "../lib/page-meta";
import { completeAgentAuthClaimFn } from "../rpc/web-mutations";

export const Route = createFileRoute("/_authed/agent-auth/claim")({
  head: ({ matches }) =>
    dashboardPageMeta("Link agent", "Confirm an agent provider identity link.", "/agent-auth/claim", matches),
  component: AgentAuthClaimPage,
});

function claimTokensFromSearch(): { claimToken: string; claimAttemptToken: string } {
  if (typeof window === "undefined") {
    return { claimToken: "", claimAttemptToken: "" };
  }
  const params = new URL(window.location.href).searchParams;
  return {
    claimToken: params.get("claim_token") ?? "",
    claimAttemptToken: params.get("claim_attempt_token") ?? "",
  };
}

function AgentAuthClaimPage() {
  const navigate = useNavigate();
  const [claimToken, setClaimToken] = useState("");
  const [claimAttemptToken, setClaimAttemptToken] = useState("");
  const [userCode, setUserCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  useLayoutEffect(() => {
    const tokens = claimTokensFromSearch();
    setClaimToken(tokens.claimToken);
    setClaimAttemptToken(tokens.claimAttemptToken);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeAgentAuthClaimFn({
        data: {
          ...(claimToken ? { claim_token: claimToken } : {}),
          ...(claimAttemptToken ? { claim_attempt_token: claimAttemptToken } : {}),
          user_code: userCode,
        },
      });
      if (result.error) {
        setError({
          message: result.error.message,
          ...(result.error.requestId ? { requestId: result.error.requestId } : {}),
        });
        return;
      }
      setDone(true);
    } catch {
      setError({ message: "Request failed." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Agent auth"
        title="Link agent"
        description="Confirm the code shown by your agent provider to link this identity to your Agent Paste account."
      />
      {error ? <ErrorBanner title="Link failed" message={error.message} requestId={error.requestId} /> : null}
      {done ? (
        <Card className="border-accent/30 bg-accent-tint">
          <CardHeader title="Agent linked" subtitle="The agent can finish registration and request an access token." />
          <Button size="lg" onClick={() => void navigate({ to: "/dashboard" })}>
            Done
          </Button>
        </Card>
      ) : (
        <Card>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <label className="grid gap-2 text-sm" htmlFor="agent-claim-token">
              <span className="text-muted">Claim reference</span>
              <Input
                id="agent-claim-token"
                value={claimAttemptToken || claimToken}
                onChange={(event) => {
                  if (claimAttemptToken) {
                    setClaimAttemptToken(event.target.value);
                  } else {
                    setClaimToken(event.target.value);
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="agent-user-code">
              <span className="text-muted">Code</span>
              <Input
                id="agent-user-code"
                value={userCode}
                onChange={(event) => setUserCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
            <Button
              type="submit"
              disabled={submitting || !(claimToken.trim() || claimAttemptToken.trim()) || userCode.length !== 6}
            >
              {submitting ? "Linking..." : "Link agent"}
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}
