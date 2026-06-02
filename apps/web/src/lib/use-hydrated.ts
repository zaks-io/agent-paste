import { useEffect, useState } from "react";

// Returns false on the server and the first client render, then true after mount.
// Gate any wall-clock-dependent render (Date.now() comparisons, relative time)
// behind this so SSR and first-paint output match and hydration stays intact.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
