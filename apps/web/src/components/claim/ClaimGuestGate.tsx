import { useLayoutEffect } from "react";
import {
  claimTokenFromLocationHash,
  clearClaimTokenFromLocation,
  stashPendingClaimToken,
} from "../../lib/claim-redemption";

/** Captures a hash claim token before WorkOS sign-in; tokens never go in query strings. */
export function ClaimGuestGate() {
  useLayoutEffect(() => {
    const token = claimTokenFromLocationHash();
    if (token) {
      stashPendingClaimToken(token);
      clearClaimTokenFromLocation();
    }
    window.location.assign("/api/auth/sign-in?returnPathname=%2Fclaim");
  }, []);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <p className="text-[14px] text-[hsl(var(--muted))]">Redirecting to sign in…</p>
    </main>
  );
}
