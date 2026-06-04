import { isConfiguredMcpOAuthVerifier, type McpWorkOsEnv, verifyMcpOAuthToken } from "./workos.js";

export type McpAuthContext = {
  tokenSub: string;
  bearerToken: string;
};

export type McpAuthSuccess = {
  ok: true;
  context: McpAuthContext;
};

export type McpAuthFailure = {
  ok: false;
  code: "invalid_token";
  message: string;
};

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

export type VerifyMcpBearer = (input: {
  authorizationHeader: string | null;
  env?: McpWorkOsEnv;
}) => McpAuthResult | Promise<McpAuthResult>;

export function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader);
  return match?.[1] ?? null;
}

export function rejectMissingBearer(): McpAuthFailure {
  return { ok: false, code: "invalid_token", message: "invalid_token" };
}

export function rejectRejectedAuthKind(kind: "api_key" | "workos_access_token"): McpAuthFailure {
  return {
    ok: false,
    code: "invalid_token",
    message: `${kind} is not accepted at the MCP surface`,
  };
}

function detectRejectedAuthKind(token: string): "api_key" | "workos_access_token" | null {
  if (token.startsWith("ap_pk_")) {
    return "api_key";
  }
  if (token.startsWith("wos_") || token.includes("workos_session")) {
    return "workos_access_token";
  }
  return null;
}

/** Stateless bearer hook used when WorkOS MCP verification is not configured. */
export function createUnconfiguredMcpBearerAuth(): VerifyMcpBearer {
  return ({ authorizationHeader }) => {
    const token = parseBearerToken(authorizationHeader);
    if (!token) {
      return rejectMissingBearer();
    }
    const rejected = detectRejectedAuthKind(token);
    if (rejected) {
      return rejectRejectedAuthKind(rejected);
    }
    return {
      ok: false,
      code: "invalid_token",
      message: "mcp_oauth_verifier_not_configured",
    };
  };
}

export function createWorkOsMcpBearerAuth(env: McpWorkOsEnv): VerifyMcpBearer {
  return async ({ authorizationHeader }) => {
    const token = parseBearerToken(authorizationHeader);
    if (!token) {
      return rejectMissingBearer();
    }
    const rejected = detectRejectedAuthKind(token);
    if (rejected) {
      return rejectRejectedAuthKind(rejected);
    }
    if (!isConfiguredMcpOAuthVerifier(env)) {
      return {
        ok: false,
        code: "invalid_token",
        message: "mcp_oauth_verifier_not_configured",
      };
    }
    const verified = await verifyMcpOAuthToken(token, env);
    if (!verified) {
      return rejectMissingBearer();
    }
    return {
      ok: true,
      context: {
        tokenSub: verified.tokenSub,
        bearerToken: token,
      },
    };
  };
}

export function createTestMcpBearerAuth(tokens: Record<string, McpAuthContext>): VerifyMcpBearer {
  return ({ authorizationHeader }) => {
    const token = parseBearerToken(authorizationHeader);
    if (!token) {
      return rejectMissingBearer();
    }
    const rejected = detectRejectedAuthKind(token);
    if (rejected) {
      return rejectRejectedAuthKind(rejected);
    }
    const context = tokens[token];
    if (!context) {
      return rejectMissingBearer();
    }
    return { ok: true, context: { ...context, bearerToken: token } };
  };
}
