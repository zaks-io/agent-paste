import { themeCookieDomain } from "./theme-cookie.js";

export const OPTIONAL_ANALYTICS_COOKIE = "agp_analytics";
export const GPC_SUPPORT_PATH = "/.well-known/gpc.json";
export const GPC_SUPPORT_BODY = `${JSON.stringify({ gpc: true, lastUpdate: "2026-06-14" }, null, 2)}\n`;

export type OptionalAnalyticsPreference = "on" | "off";

type HeaderGetter = (name: string) => string | null | undefined;

type OptionalAnalyticsRequest = {
  getHeader?: HeaderGetter | undefined;
  cookieString?: string | null | undefined;
  secGpc?: string | null | undefined;
  dnt?: string | null | undefined;
};

const COOKIE_MAX_AGE_SECONDS = 31536000;

export function readOptionalAnalyticsCookie(
  cookieString: string | null | undefined,
): OptionalAnalyticsPreference | null {
  if (!cookieString) {
    return null;
  }
  for (const part of cookieString.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() === OPTIONAL_ANALYTICS_COOKIE) {
      const value = rest.join("=").trim();
      return value === "on" || value === "off" ? value : null;
    }
  }
  return null;
}

export function optionalAnalyticsCookieDomain(hostname: string): string | null {
  return themeCookieDomain(hostname);
}

export function buildOptionalAnalyticsCookie(
  value: OptionalAnalyticsPreference,
  hostname: string,
  secure: boolean,
): string {
  const domain = optionalAnalyticsCookieDomain(hostname);
  const attrs = [
    `${OPTIONAL_ANALYTICS_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    domain ? `Domain=${domain}` : "",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return attrs.join("; ");
}

export function hasBrowserPrivacySignal(input: OptionalAnalyticsRequest): boolean {
  const secGpc = input.secGpc ?? input.getHeader?.("sec-gpc") ?? input.getHeader?.("Sec-GPC");
  if (headerContainsValue(secGpc, "1")) {
    return true;
  }
  const dnt = input.dnt ?? input.getHeader?.("dnt") ?? input.getHeader?.("DNT");
  return headerContainsValue(dnt, "1");
}

export function shouldDisableOptionalAnalytics(input: OptionalAnalyticsRequest): boolean {
  if (hasBrowserPrivacySignal(input)) {
    return true;
  }
  const cookieString = input.cookieString ?? input.getHeader?.("cookie") ?? input.getHeader?.("Cookie");
  return readOptionalAnalyticsCookie(cookieString) === "off";
}

function headerContainsValue(value: string | null | undefined, expected: string): boolean {
  if (!value) {
    return false;
  }
  return value.split(",").some((part) => part.trim() === expected);
}
