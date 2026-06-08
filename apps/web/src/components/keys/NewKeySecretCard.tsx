import { Button, Card, CardHeader } from "@agent-paste/ui";

type Props = {
  secret: string;
  onDismiss: () => void;
};

export function NewKeySecretCard({ secret, onDismiss }: Props) {
  return (
    <Card className="border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent-tint))]">
      <CardHeader
        title="Copy your new key secret"
        subtitle="This is shown once and never again. Store it somewhere safe."
        className="mb-4"
        actions={
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />
      <code className="block overflow-x-auto rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface-sunken))] px-3 py-2 font-mono text-[12px]">
        {secret}
      </code>
    </Card>
  );
}
