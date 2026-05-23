import { Link } from "@tanstack/react-router";
import { Building2, UserRound } from "lucide-react";
import { SignOutForm } from "./SignOutForm";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

type TopbarUser = {
  id: string;
  email: string | null;
};

export function Topbar({ user, workspaceName }: { user: TopbarUser; workspaceName?: string }) {
  return (
    <header
      className="
        h-[52px] flex items-center justify-between gap-4 px-6
        border-b border-[hsl(var(--rule))] bg-[hsl(var(--background))]
      "
    >
      <div className="flex items-center gap-5">
        <Link to="/dashboard" className="flex items-center" aria-label="agent-paste home">
          <Wordmark />
        </Link>
        <div className="hidden md:flex items-center gap-2 text-[13px] text-[hsl(var(--muted))]">
          <Building2 size={14} strokeWidth={1.5} />
          <span>{workspaceName ?? "Workspace"}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <div
          className="
            flex items-center gap-2 text-[13px] text-[hsl(var(--foreground))]
            px-3 py-1 rounded-[var(--radius-sm)]
          "
        >
          <UserRound size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Signed in as {user.email ?? user.id}</span>
          <span className="hidden sm:inline" aria-hidden="true">
            {user.email ?? user.id}
          </span>
        </div>
        <SignOutForm />
      </div>
    </header>
  );
}
