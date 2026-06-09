import { Button, Card, CardHeader } from "@agent-paste/ui";

type Props = {
  secret: string;
  onDismiss: () => void;
};

export function NewKeySecretCard({ secret, onDismiss }: Props) {
  return (
    <Card className="border-accent/30 bg-accent-tint">
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
      <code className="block overflow-x-auto rounded-sm border border-rule bg-surface-sunken px-3 py-2 font-mono text-xs">
        {secret}
      </code>
    </Card>
  );
}
