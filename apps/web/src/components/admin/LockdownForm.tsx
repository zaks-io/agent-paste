import { FileWarning, ShieldBan } from "lucide-react";
import { type FormEvent, useState } from "react";
import { setLockdownFn } from "../../server/web-mutations";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Input } from "../ui/Input";
import { errorToast, useToast } from "../ui/toast-context";

type Props = {
  onSuccess: () => void;
};

const scopes = [
  { value: "artifact", label: "Artifact", Icon: FileWarning },
  { value: "workspace", label: "Workspace", Icon: ShieldBan },
] as const;

export function LockdownForm({ onSuccess }: Props) {
  const { push } = useToast();
  const [scope, setScope] = useState<"artifact" | "workspace">("artifact");
  const [targetId, setTargetId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedId = targetId.trim();
    const trimmedReason = reasonCode.trim();

    if (!trimmedId) {
      push({ tone: "error", title: "Invalid input", message: "Target ID is required." });
      return;
    }
    if (!trimmedReason) {
      push({ tone: "error", title: "Invalid input", message: "Reason code is required." });
      return;
    }

    setPending(true);
    try {
      const result = await setLockdownFn({
        data: { scope, target_id: trimmedId, reason_code: trimmedReason },
      });
      if (result.error) {
        push(errorToast("Couldn't set lockdown", result.error));
        return;
      }
      setTargetId("");
      setReasonCode("");
      setScope("artifact");
      push({ tone: "success", title: "Lockdown set", message: `Platform lockdown activated.` });
      onSuccess();
    } catch (error) {
      push({
        tone: "error",
        title: "Couldn't set lockdown",
        message: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Set lockdown" subtitle="Block link resolution for an artifact or workspace." />
      <form className="grid max-w-[420px] gap-4" onSubmit={onSubmit}>
        <div className="grid gap-1">
          <span className="text-[12px] text-[hsl(var(--muted))]">Scope</span>
          <div className="inline-grid w-fit grid-cols-2 rounded-[var(--radius-md)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface-sunken))] p-1">
            {scopes.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className="inline-flex h-[30px] items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium data-[active=true]:bg-[hsl(var(--surface))] data-[active=true]:shadow-sm"
                data-active={scope === value ? "true" : undefined}
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                disabled={pending}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <label htmlFor="target-id" className="grid gap-1">
          <span className="text-[12px] text-[hsl(var(--muted))]">Target ID</span>
          <Input
            id="target-id"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            placeholder={scope === "artifact" ? "art_..." : "ws_..."}
            disabled={pending}
          />
        </label>
        <label htmlFor="reason-code" className="grid gap-1">
          <span className="text-[12px] text-[hsl(var(--muted))]">Reason code</span>
          <Input
            id="reason-code"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            placeholder="e.g., phishing_report, abuse_complaint"
            maxLength={120}
            disabled={pending}
          />
        </label>
        <div>
          <Button type="submit" size="sm" loading={pending} disabled={!targetId.trim() || !reasonCode.trim()}>
            Set lockdown
          </Button>
        </div>
      </form>
    </Card>
  );
}
