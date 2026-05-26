const RETURN_PATH_PREFIX = "/api/auth/sign-in/p/";

export function parseReturnPathname(raw: string | null | undefined): string | undefined {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(encoded: string): string | undefined {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(padded + padding);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export function encodeReturnPathname(pathname: string): string {
  return encodeBase64Url(pathname);
}

export function decodeReturnPathname(encoded: string): string | undefined {
  return parseReturnPathname(decodeBase64Url(encoded));
}

export function signInBridgeHref(returnPathname: string): string {
  return `${RETURN_PATH_PREFIX}${encodeReturnPathname(returnPathname)}`;
}
