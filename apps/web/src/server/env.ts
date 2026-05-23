export type WebEnv = {
  AGENT_PASTE_ENV: "dev" | "preview" | "production";
  API_BASE_URL: string;
  WEB_BASE_URL: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_API_KEY: string;
  WORKOS_REDIRECT_URI: string;
  WORKOS_COOKIE_PASSWORD: string;
  WORKOS_COOKIE_NAME?: string;
  OPERATOR_EMAILS: string;
  ASSETS: Fetcher;
  API?: Fetcher;
};

export function getOperatorEmails(env: WebEnv): readonly string[] {
  return env.OPERATOR_EMAILS.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isOperator(env: WebEnv, email: string | null | undefined): boolean {
  if (!email) return false;
  return getOperatorEmails(env).includes(email.toLowerCase());
}
