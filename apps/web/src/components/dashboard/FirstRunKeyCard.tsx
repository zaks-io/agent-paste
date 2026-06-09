import { Button, Card, CardHeader } from "@agent-paste/ui";
import { useState } from "react";

type Props = {
  secret: string | null;
};

export function FirstRunKeyCard({ secret }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Card className="border-accent/30 bg-accent-tint">
      <CardHeader
        title="Your default API key"
        subtitle={
          <>
            Created with your workspace for CI and headless use. The CLI provisions its own key when you run{" "}
            <code className="font-mono text-xs">npx @zaks-io/agent-paste login</code>. Copy it now, since the secret is
            shown only once.
          </>
        }
        className="mb-4"
      />
      {secret ? (
        <div className="grid gap-3">
          {revealed ? (
            <code className="block overflow-x-auto rounded-sm border border-rule bg-surface-sunken px-3 py-2 font-mono text-xs">
              {secret}
            </code>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
              Reveal secret
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          The one-time secret was shown when your workspace was created. If you missed it, create a new key from the API
          Keys page.
        </p>
      )}
    </Card>
  );
}
