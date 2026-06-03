import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { CommandPaletteTrigger } from "./command-palette/CommandPaletteTrigger";
import { SignOutForm } from "./SignOutForm";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

type TopbarUser = {
  id: string;
  email: string | null;
};

export function Topbar({ user, workspaceName }: { user: TopbarUser; workspaceName?: string | undefined }) {
  return (
    <header
      className="
        sticky top-0 z-30 h-[57px]
        grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5
        border-b border-[hsl(var(--rule))]
        bg-[hsl(var(--background)/0.85)] backdrop-blur-md
      "
    >
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/dashboard" className="flex items-center shrink-0" aria-label="agent-paste home">
          <Wordmark />
        </Link>
        {workspaceName ? (
          <>
            <span aria-hidden className="text-[hsl(var(--rule-strong))] select-none">
              /
            </span>
            <div className="hidden md:flex items-center gap-1.5 text-[13px] text-[hsl(var(--muted))] min-w-0">
              <Building2 size={13} strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">{workspaceName}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex justify-center">
        <CommandPaletteTrigger />
      </div>

      <div className="flex items-center justify-end gap-1.5 min-w-0">
        <ThemeToggle />
        <span aria-hidden className="hidden sm:block h-5 w-px bg-[hsl(var(--rule))] mx-1" />
        <span
          className="hidden sm:flex items-center gap-2 text-[13px] text-[hsl(var(--muted))] min-w-0 max-w-[220px]"
          title={user.email ?? user.id}
        >
          <UserAvatar email={user.email} />
          <span className="truncate">{user.email ?? user.id}</span>
        </span>
        <span className="sr-only">Signed in as {user.email ?? user.id}</span>
        <span aria-hidden className="hidden sm:block h-5 w-px bg-[hsl(var(--rule))] mx-1" />
        <SignOutForm />
      </div>
    </header>
  );
}

function UserAvatar({ email }: { email: string | null }) {
  const initial = (email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="
        grid place-items-center shrink-0 h-[22px] w-[22px] rounded-[var(--radius-xs)]
        bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent))]
        font-mono text-[11px] font-semibold border border-[hsl(var(--accent)/0.35)]
      "
    >
      {initial}
    </span>
  );
}
