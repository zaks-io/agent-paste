import { Link } from "@tanstack/react-router";
import { Building2, UserRound } from "lucide-react";
import { CommandPaletteTrigger } from "./command-palette/CommandPaletteTrigger";
import { SignOutForm } from "./SignOutForm";
import { Wordmark } from "./Wordmark";

type TopbarUser = {
  id: string;
  email: string | null;
};

export function Topbar({ user, workspaceName }: { user: TopbarUser; workspaceName?: string }) {
  return (
    <header
      className="
        h-[52px] grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6
        border-b border-[hsl(var(--rule))] bg-[hsl(var(--background))]
      "
    >
      <div className="flex items-center gap-5 min-w-0">
        <Link to="/dashboard" className="flex items-center shrink-0" aria-label="agent-paste home">
          <Wordmark />
        </Link>
        <div className="hidden md:flex items-center gap-2 text-[13px] text-[hsl(var(--muted))] min-w-0">
          <Building2 size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{workspaceName ?? "Workspace"}</span>
        </div>
      </div>

      <div className="flex justify-center">
        <CommandPaletteTrigger />
      </div>

      <div className="flex items-center justify-end gap-3 min-w-0">
        <div
          className="
            flex items-center gap-2 text-[13px] text-[hsl(var(--foreground))]
            px-3 py-1 rounded-[var(--radius-sm)] min-w-0
          "
        >
          <UserRound size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Signed in as {user.email ?? user.id}</span>
          <span className="hidden sm:inline truncate" aria-hidden="true">
            {user.email ?? user.id}
          </span>
        </div>
        <SignOutForm />
      </div>
    </header>
  );
}
