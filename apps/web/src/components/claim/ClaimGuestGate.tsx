import { useLayoutEffect } from "react";
import {
  claimCodeFromLocationSearch,
  claimTokenFromLocationHash,
  clearClaimTokenFromLocation,
  stashPendingClaimCode,
  stashPendingClaimToken,
} from "../../lib/claim-redemption";

/** Captures a hash claim token before WorkOS sign-in; tokens never go in query strings. */
export function ClaimGuestGate() {
  useLayoutEffect(() => {
    const token = claimTokenFromLocationHash();
    const claimCode = claimCodeFromLocationSearch();
    if (token) {
      stashPendingClaimToken(token);
      clearClaimTokenFromLocation();
    }
    if (claimCode) {
      stashPendingClaimCode(claimCode);
    }
    window.location.assign("/api/auth/sign-in?returnPathname=%2Fclaim");
  }, []);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <p className="text-base text-muted">Redirecting to sign in…</p>
    </main>
  );
}
