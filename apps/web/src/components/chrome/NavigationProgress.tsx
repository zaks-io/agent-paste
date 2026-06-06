import { useRouterState } from "@tanstack/react-router";

export function isNavigationPending(status: string) {
  return status === "pending" || status === "loading";
}

export function NavigationProgress() {
  const pending = useRouterState({
    select: (state) => isNavigationPending(state.status),
  });

  if (!pending) return null;

  return (
    <div
      aria-label="Navigation loading"
      aria-valuetext="Loading"
      className="fixed left-0 right-0 top-0 z-50 h-[2px] bg-[hsl(var(--accent))]"
      role="progressbar"
    />
  );
}
