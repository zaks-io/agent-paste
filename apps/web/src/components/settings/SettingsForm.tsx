import type { WebSettingsResponse } from "@agent-paste/contracts";
import { Button, Card, CardHeader } from "@agent-paste/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { queryKeys } from "../../lib/queries";
import { saveSettingsFn } from "../../rpc/web-mutations";
import { Input } from "../ui/Input";
import { errorToast, useToast } from "../ui/toast-context";

export function SettingsForm({ settings }: { settings: WebSettingsResponse }) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(settings.workspace_name);
  const [days, setDays] = useState(String(settings.auto_deletion_days));
  const [pending, setPending] = useState(false);
  const minAutoDeletionDays = settings.auto_deletion_bounds.min_days;
  const maxAutoDeletionDays = settings.auto_deletion_bounds.max_days;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsedDays = Number(days);
    if (!Number.isInteger(parsedDays) || parsedDays < minAutoDeletionDays || parsedDays > maxAutoDeletionDays) {
      push({
        tone: "error",
        title: "Invalid auto-deletion",
        message: `Enter a whole number between ${minAutoDeletionDays} and ${maxAutoDeletionDays}.`,
      });
      return;
    }
    setPending(true);
    try {
      const result = await saveSettingsFn({
        data: { workspace_name: name.trim(), auto_deletion_days: parsedDays },
      });
      if (result.error) {
        push(errorToast("Couldn't save settings", result.error));
        return;
      }
      // Sync local state to the persisted, canonical values (server trims the
      // name and clamps the day count) so the form stops showing stale input.
      setName(result.data.workspace_name);
      setDays(String(result.data.auto_deletion_days));
      push({ tone: "success", title: "Settings saved", message: "Workspace settings updated." });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Workspace settings" subtitle="Name and auto-deletion window." className="mb-5" />
      <form className="grid max-w-[420px] gap-4" onSubmit={onSubmit}>
        <label htmlFor="workspace-name" className="grid gap-1">
          <span className="text-[12px] text-[hsl(var(--muted))]">Workspace name</span>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            disabled={pending}
          />
        </label>
        <label htmlFor="auto-deletion-days" className="grid max-w-[200px] gap-1">
          <span className="text-[12px] text-[hsl(var(--muted))]">Auto-deletion (days)</span>
          <Input
            id="auto-deletion-days"
            type="number"
            min={minAutoDeletionDays}
            max={maxAutoDeletionDays}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            disabled={pending}
          />
        </label>
        <div>
          <Button type="submit" size="sm" loading={pending} disabled={name.trim().length === 0}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
