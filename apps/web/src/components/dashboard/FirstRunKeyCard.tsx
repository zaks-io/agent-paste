import { useState } from "react";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";

type Props = {
  secret: string | null;
};

export function FirstRunKeyCard({ secret }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Your default API key"
        subtitle="Created with your workspace. Copy it now — the secret is shown once and never again."
      />
      {secret ? (
        <div className="grid gap-3">
          {revealed ? (
            <code className="block overflow-x-auto rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface-sunken))] px-3 py-2 font-mono text-[12px]">
              {secret}
            </code>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
              Reveal secret
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[hsl(var(--muted))]">
          The one-time secret was shown right after sign-in. If you missed it, create a new key from the API Keys page.
        </p>
      )}
    </Card>
  );
}
