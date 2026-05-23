export function SignOutForm() {
  return (
    <form method="post" action="/api/auth/sign-out" className="inline">
      <button
        type="submit"
        className="text-[13px] text-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors duration-[80ms]"
      >
        Sign out
      </button>
    </form>
  );
}
