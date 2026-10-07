import { createSign } from "node:crypto";
import {
  AuthKitCore,
  configure,
  getConfigurationProvider,
  getWorkOS,
  sessionEncryption,
} from "@workos/authkit-session";
import { createLocalMcpWorkOsStub } from "./smoke-mcp-local.mjs";
import { listenHttpPort } from "./smoke-port.mjs";

export async function startLocalCloudflareAuth(cookiePassword) {
  const port = 18791;
  const issuer = `http://127.0.0.1:${port}`;
  const apiKey = "sk_test_local_cloudflare";
  const clientId = "client_local_cloudflare";
  const stub = createLocalMcpWorkOsStub(issuer, apiKey, clientId);
  await listenHttpPort(stub.server, port, { envVar: "local Cloudflare auth port", label: "WorkOS fixture" });
  const subject = "user_local_cloudflare";
  const claims = {
    sub: subject,
    iss: issuer,
    sid: "session_local_cloudflare",
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "RS256", kid: stub.keyId, typ: "JWT" })}.${encode(claims)}`;
  const sign = (payload) =>
    `${payload}.${createSign("RSA-SHA256").update(payload).sign(stub.privateKey).toString("base64url")}`;
  const accessToken = sign(payload);
  const mcpPayload = `${encode({ alg: "RS256", kid: stub.keyId, typ: "JWT" })}.${encode({ ...claims, aud: "http://127.0.0.1:8792/", scope: "write read share" })}`;
  configure({
    clientId,
    apiKey,
    redirectUri: "http://localhost:5173/api/auth/callback",
    cookiePassword,
    cookieName: "__agp_session",
    cookieSameSite: "lax",
    apiHostname: "127.0.0.1",
    apiPort: port,
    apiHttps: false,
  });
  const core = new AuthKitCore(getConfigurationProvider().getConfig(), getWorkOS(), sessionEncryption);
  const session = await core.encryptSession({
    accessToken,
    refreshToken: "refresh_local_cloudflare",
    user: {
      object: "user",
      id: subject,
      email: "local-cloudflare@example.test",
      emailVerified: true,
      profilePictureUrl: null,
      firstName: "Local",
      lastName: "Developer",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  return {
    server: stub.server,
    accessToken,
    mcpToken: sign(mcpPayload),
    vars: {
      ...stub.workosEnv,
      WORKOS_API_HOSTNAME: "127.0.0.1",
      WORKOS_API_PORT: String(port),
      WORKOS_API_HTTPS: "false",
      WORKOS_COOKIE_NAME: "__agp_session",
      WORKOS_COOKIE_PASSWORD: cookiePassword,
      LOCAL_DEV_SESSION: session,
    },
  };
}
