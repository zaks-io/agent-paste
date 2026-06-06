import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const NAVIGATION_PROGRESS_DELAY_MS = 100;
export const NAVIGATION_PROGRESS_MIN_VISIBLE_MS = 200;

export function isNavigationPending(status: string) {
  return status === "pending" || status === "loading";
}

export function NavigationProgress() {
  const pending = useRouterState({
    select: (state) => isNavigationPending(state.status),
  });
  const visible = useDelayedProgress(pending);

  if (!visible) return null;

  return (
    <div
      aria-label="Navigation loading"
      aria-valuetext="Loading"
      className="fixed left-0 right-0 top-0 z-50 h-[2px] bg-[hsl(var(--accent))]"
      role="progressbar"
    />
  );
}

function useDelayedProgress(pending: boolean) {
  const [visible, setVisible] = useState(false);
  const visibleSince = useRef<number | null>(null);

  useEffect(() => {
    if (pending) {
      if (visible) return;

      const showTimer = setTimeout(() => {
        visibleSince.current = Date.now();
        setVisible(true);
      }, NAVIGATION_PROGRESS_DELAY_MS);

      return () => clearTimeout(showTimer);
    }

    if (!visible) {
      visibleSince.current = null;
      return;
    }

    const visibleForMs = Date.now() - (visibleSince.current ?? Date.now());
    const remainingMs = NAVIGATION_PROGRESS_MIN_VISIBLE_MS - visibleForMs;

    if (remainingMs <= 0) {
      visibleSince.current = null;
      setVisible(false);
      return;
    }

    const hideTimer = setTimeout(() => {
      visibleSince.current = null;
      setVisible(false);
    }, remainingMs);

    return () => clearTimeout(hideTimer);
  }, [pending, visible]);

  return visible;
}
