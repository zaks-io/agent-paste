import { Badge, Button, Card } from "@agent-paste/ui";
import { useState } from "react";
import { setAccessLinkLockdownFn } from "../../rpc/web-mutations";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  artifactId: string;
  locked: boolean;
  onChanged: () => void | Promise<void>;
};

// Access Link Lockdown is member-controllable and distinct from operator Platform
// Lockdown. It blocks creating and minting links but leaves revoke and listing
// intact, so existing recipients can still be cut off while the artifact is locked.
export function AccessLinkLockdownToggle({ artifactId, locked, onChanged }: Props) {
  const { push } = useToast();
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    try {
      const result = await setAccessLinkLockdownFn({ data: { artifactId, locked: !locked } });
      if (result.error) {
        push(errorToast("Couldn't change lockdown", result.error));
        return;
      }
      push({
        tone: "success",
        title: locked ? "Lockdown lifted" : "Lockdown engaged",
        message: locked
          ? "New Access Links can be created and minted again."
          : "Creating and minting Access Links is blocked.",
      });
      await onChanged();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]">
            Access Link Lockdown
          </h3>
          <Badge tone={locked ? "destructive" : "neutral"} dot>
            {locked ? "Engaged" : "Off"}
          </Badge>
        </div>
        <p className="mt-1 text-[12.5px] text-[hsl(var(--subtle))]">
          Blocks creating and minting links. Revoke and the list below stay available.
        </p>
      </div>
      <Button variant={locked ? "secondary" : "destructive"} loading={pending} onClick={toggle}>
        {locked ? "Lift lockdown" : "Engage lockdown"}
      </Button>
    </Card>
  );
}
