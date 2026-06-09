export function SignOutForm() {
  return (
    <form method="post" action="/api/auth/sign-out" className="inline">
      <button type="submit" className="text-sm text-muted hover:text-foreground transition-colors duration-[80ms]">
        Sign out
      </button>
    </form>
  );
}
