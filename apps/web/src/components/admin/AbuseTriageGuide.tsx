import { PLATFORM_LOCKDOWN_REASON_CODES } from "@agent-paste/contracts";
import { Card, CardHeader } from "@agent-paste/ui";
import { Link } from "@tanstack/react-router";

const WORKFLOW_STEPS = [
  "Filter platform events to Security focus and locate the workspace or artifact involved.",
  "Prefer Platform Lockdown over deletion so wrongly flagged content can be restored.",
  "Record a stable reason code (no free-text operator notes in audit summaries).",
  "Lift the lockdown after remediation or when a report is cleared.",
] as const;

export function AbuseTriageGuide() {
  return (
    <Card>
      <CardHeader
        title="Abuse triage"
        subtitle="Respond to phishing, malware, or policy reports without destroying bytes."
      />
      <ol className="mb-4 list-decimal space-y-2 pl-5 text-[13px] text-[hsl(var(--foreground))]">
        {WORKFLOW_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mb-2 text-[12px] text-[hsl(var(--muted))]">Suggested reason codes</p>
      <p className="mb-4 font-mono text-[12px] text-[hsl(var(--muted))]">
        {PLATFORM_LOCKDOWN_REASON_CODES.join(" · ")}
      </p>
      <Link
        to="/admin"
        search={{ focus: "security" }}
        className="text-[13px] font-medium text-[hsl(var(--accent))] hover:underline"
      >
        Browse security events
      </Link>
    </Card>
  );
}
