import "@tanstack/react-start/server-only";

import { getGlobalStartContext } from "@tanstack/react-start";
import type { AuthResult, NoUserInfo, User, UserInfo } from "@workos/authkit-tanstack-react-start";

type AuthkitStartContext = {
  auth?: () => AuthResult<User>;
  request?: Request;
};

type HeaderBag = Record<string, string | string[]>;
type HeaderSource = {
  response?: Response;
  headers?: HeaderBag;
};

export type ServerAuth = UserInfo | NoUserInfo;

export function getServerAuth(): ServerAuth {
  const context = getGlobalStartContext() as AuthkitStartContext | undefined;
  const auth = context?.auth?.();
  if (!auth?.user) return { user: null };
  return {
    user: auth.user,
    sessionId: auth.sessionId,
    accessToken: auth.accessToken,
    ...(auth.claims.org_id ? { organizationId: auth.claims.org_id } : {}),
    ...(auth.claims.role ? { role: auth.claims.role } : {}),
    ...(auth.claims.roles ? { roles: auth.claims.roles } : {}),
    ...(auth.claims.permissions ? { permissions: auth.claims.permissions } : {}),
    ...(auth.claims.entitlements ? { entitlements: auth.claims.entitlements } : {}),
    ...(auth.claims.feature_flags ? { featureFlags: auth.claims.feature_flags } : {}),
    ...(auth.impersonator ? { impersonator: auth.impersonator } : {}),
  };
}

export function appendAuthkitHeaders(target: Headers, source: HeaderSource): void {
  const responseHeaders = source.response?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
  for (const cookie of responseHeaders?.getSetCookie?.() ?? []) {
    target.append("Set-Cookie", cookie);
  }
  if (!source.headers) return;
  for (const [key, value] of Object.entries(source.headers)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      target.append(key, entry);
    }
  }
}
