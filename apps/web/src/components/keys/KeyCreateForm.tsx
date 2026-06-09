import { Button, Card, CardHeader } from "@agent-paste/ui";
import { type FormEvent, useState } from "react";
import { createKeyFn } from "../../rpc/web-mutations";
import { Input } from "../ui/Input";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  onCreated: () => void;
  onSecret: (secret: string) => void;
};

export function KeyCreateForm({ onCreated, onSecret }: Props) {
  const { push } = useToast();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || pending) return;
    setPending(true);
    try {
      const result = await createKeyFn({ data: { name: trimmed } });
      if (result.error) {
        push(errorToast("Couldn't create key", result.error));
        return;
      }
      onSecret(result.data.secret);
      setName("");
      onCreated();
      push({ tone: "success", title: "Key created", message: `"${result.data.api_key.name}" is ready.` });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Create a key" subtitle="Name it so you remember where it runs." className="mb-5" />
      <form className="flex max-w-[480px] items-end gap-3" onSubmit={onSubmit}>
        <label htmlFor="new-key-name" className="grid flex-1 gap-1">
          <span className="text-xs text-muted">Key name</span>
          <Input
            id="new-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ci-publisher"
            maxLength={120}
            disabled={pending}
          />
        </label>
        <Button type="submit" size="md" loading={pending} disabled={name.trim().length === 0}>
          Create key
        </Button>
      </form>
    </Card>
  );
}
