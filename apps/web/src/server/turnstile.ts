import type { WebEnv } from "./env";
import { getWebEnv } from "./runtime";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const LOCAL_TURNSTILE_BYPASS_TOKEN = "local-turnstile-bypass";

export function turnstileSiteKey(env: Pick<WebEnv, "TURNSTILE_SITE_KEY"> = getWebEnv()): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  return siteKey ? siteKey : null;
}

export async function verifyTurnstileToken(
  token: string,
  env: Pick<WebEnv, "AGENT_PASTE_ENV" | "TURNSTILE_SECRET_KEY"> = getWebEnv(),
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    return false;
  }

  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return env.AGENT_PASTE_ENV === "dev" && trimmed === LOCAL_TURNSTILE_BYPASS_TOKEN;
  }

  const body = new URLSearchParams({ secret, response: trimmed });
  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    return false;
  }
  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
}
