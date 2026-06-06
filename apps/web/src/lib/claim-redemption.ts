const CLAIM_TOKEN_PATTERN = /^ap_ct_(preview|production)_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{32,}$/;

export const PENDING_CLAIM_TOKEN_STORAGE_KEY = "agent-paste:pending-claim-token";

export function isClaimToken(value: string): boolean {
  return CLAIM_TOKEN_PATTERN.test(value.trim());
}

/** Read a claim token from the URL hash (never from query strings). */
export function claimTokenFromLocationHash(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw || !isClaimToken(raw)) return undefined;
  return raw;
}

export function stashPendingClaimToken(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PENDING_CLAIM_TOKEN_STORAGE_KEY, token);
}

export function consumePendingClaimToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const token = sessionStorage.getItem(PENDING_CLAIM_TOKEN_STORAGE_KEY)?.trim();
  sessionStorage.removeItem(PENDING_CLAIM_TOKEN_STORAGE_KEY);
  if (!token || !isClaimToken(token)) return undefined;
  return token;
}

export function claimSuccessPath(artifactIds: string[]): string {
  const [artifactId] = artifactIds;
  if (artifactIds.length === 1 && artifactId) {
    return `/artifacts/${encodeURIComponent(artifactId)}`;
  }
  return "/artifacts";
}

export function clearClaimTokenFromLocation(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

/** User-safe copy; must not reveal whether a token matched a workspace. */
export function claimRedemptionErrorMessage(error: { code: string; status: number; message: string }): string {
  if (error.code === "not_found" || error.status === 404) {
    return "This claim token is invalid, expired, or was already redeemed.";
  }
  if (error.code === "turnstile_failed") {
    return "Turnstile verification failed. Try again.";
  }
  if (error.code === "validation_error") {
    return error.message;
  }
  if (error.code === "unauthorized" || error.status === 401) {
    return "Sign in to redeem a claim token.";
  }
  return "Claim request failed. Try again.";
}
