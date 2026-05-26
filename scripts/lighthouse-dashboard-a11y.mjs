#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  AuthKitCore,
  configure,
  getConfigurationProvider,
  getWorkOS,
  sessionEncryption,
} from "@workos/authkit-session";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));
const webWranglerConfig = fileURLToPath(new URL("../apps/web/dist/server/wrangler.json", import.meta.url));
const localServerEntry = fileURLToPath(new URL("./local-mvp-server.mjs", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

const apiPort = intEnv("AGENT_PASTE_LIGHTHOUSE_API_PORT", 18887);
const uploadPort = intEnv("AGENT_PASTE_LIGHTHOUSE_UPLOAD_PORT", 18888);
const contentPort = intEnv("AGENT_PASTE_LIGHTHOUSE_CONTENT_PORT", 18889);
const workosPort = intEnv("AGENT_PASTE_LIGHTHOUSE_WORKOS_PORT", 18890);
const webPort = intEnv("AGENT_PASTE_LIGHTHOUSE_WEB_PORT", 18991);
const minScore = intEnv("AGENT_PASTE_LIGHTHOUSE_A11Y_MIN_SCORE", 95);

const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const workosBaseUrl = `http://127.0.0.1:${workosPort}`;
const dashboardUrl = `${webBaseUrl}/dashboard`;

const adminToken = process.env.AGENT_PASTE_ADMIN_TOKEN ?? "local-admin-token";
const workosApiKey = "sk_test_local_lighthouse_a11y";
const workosClientId = "client_local_lighthouse_a11y";
const cookiePassword = "local-lighthouse-cookie-password-32chars";
const cookieName = "__agp_session";
const workosUserId = "user_lighthouse_a11y";

const keyId = "local-lighthouse-a11y-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" };

const children = [];
let workosServer;

try {
  await assertBuildArtifacts();
  workosServer = createWorkOsServer();
  await listen(workosServer, workosPort);

  const localServer = spawnChild(process.execPath, [localServerEntry], {
    AGENT_PASTE_LOCAL_API_PORT: String(apiPort),
    AGENT_PASTE_LOCAL_UPLOAD_PORT: String(uploadPort),
    AGENT_PASTE_LOCAL_CONTENT_PORT: String(contentPort),
    AGENT_PASTE_ADMIN_TOKEN: adminToken,
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_API_BASE_URL: workosBaseUrl,
    WORKOS_ISSUER: workosBaseUrl,
  });

  const webServer = spawnChild(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--config",
      webWranglerConfig,
      "--port",
      String(webPort),
      "--ip",
      "127.0.0.1",
      ...webWranglerVars(),
    ],
    {},
    { cwd: webRoot },
  );

  await waitForHealthy(`${apiBaseUrl}/admin/whoami`, { authorization: `Bearer ${adminToken}` }, localServer);
  await waitForHealthy(`${webBaseUrl}/healthz`, {}, webServer);

  const primaryToken = signWorkOsToken(workosUserId);
  await fetchJson(`${apiBaseUrl}/v1/auth/web/callback`, {
    method: "POST",
    headers: { authorization: `Bearer ${primaryToken}` },
  });

  const returningToken = signWorkOsToken(workosUserId, `${workosUserId}_return`);
  const sessionCookie = await createSessionCookie(returningToken);
  await assertDashboardReady(sessionCookie);

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const result = await lighthouse(dashboardUrl, {
      logLevel: "error",
      output: "json",
      port: chrome.port,
      onlyCategories: ["accessibility"],
      extraHeaders: {
        Cookie: `${cookieName}=${encodeURIComponent(sessionCookie)}`,
      },
    });

    const score = Math.round((result?.lhr?.categories?.accessibility?.score ?? 0) * 100);
    const audits = result?.lhr?.audits ?? {};
    const failingAudits = Object.values(audits)
      .filter((audit) => audit.score !== null && audit.score < 1)
      .map((audit) => `${audit.id}: ${audit.title}`)
      .sort();

    process.stdout.write(`Lighthouse accessibility score for ${dashboardUrl}: ${score}\n`);
    if (failingAudits.length > 0) {
      process.stdout.write(`Failing audits:\n${failingAudits.map((line) => `- ${line}`).join("\n")}\n`);
    }

    if (score < minScore) {
      throw new Error(`accessibility score ${score} is below required minimum ${minScore}`);
    }

    process.stdout.write(`Dashboard Lighthouse accessibility gate passed (${score} >= ${minScore}).\n`);
  } finally {
    await chrome.kill();
  }
} catch (error) {
  process.stderr.write(
    `Dashboard Lighthouse accessibility gate failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await shutdownChildren();
  if (workosServer) {
    await close(workosServer);
  }
}

async function assertBuildArtifacts() {
  try {
    await access(webWranglerConfig);
  } catch {
    throw new Error("apps/web is not built; run `pnpm build` before `pnpm lighthouse:dashboard-a11y`");
  }
}

function webWranglerVars() {
  return [
    "--var",
    `API_BASE_URL:${apiBaseUrl}`,
    "--var",
    `WEB_BASE_URL:${webBaseUrl}`,
    "--var",
    `WORKOS_CLIENT_ID:${workosClientId}`,
    "--var",
    `WORKOS_REDIRECT_URI:${webBaseUrl}/api/auth/callback`,
    "--var",
    `WORKOS_COOKIE_NAME:${cookieName}`,
    "--var",
    "AGENT_PASTE_ENV:dev",
    "--var",
    `WORKOS_API_KEY:${workosApiKey}`,
    "--var",
    `WORKOS_COOKIE_PASSWORD:${cookiePassword}`,
    "--var",
    "WORKOS_API_HOSTNAME:127.0.0.1",
    "--var",
    `WORKOS_API_PORT:${workosPort}`,
    "--var",
    "WORKOS_API_HTTPS:false",
  ];
}

function createWorkOsServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", workosBaseUrl);
    if (url.pathname === `/sso/jwks/${workosClientId}`) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    const userMatch = url.pathname.match(/^\/user_management\/users\/([^/]+)$/);
    if (userMatch) {
      if (request.headers.authorization !== `Bearer ${workosApiKey}`) {
        response.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const id = decodeURIComponent(userMatch[1]);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ id, email: `${id}@example.test` }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

function signWorkOsToken(subject, session = subject) {
  const header = { alg: "RS256", kid: keyId, typ: "JWT" };
  const payload = {
    sub: subject,
    iss: workosBaseUrl,
    sid: `session_${session}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encoded = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(encoded).sign(privateKey).toString("base64url");
  return `${encoded}.${signature}`;
}

async function createSessionCookie(accessToken) {
  configure({
    clientId: workosClientId,
    apiKey: workosApiKey,
    redirectUri: `${webBaseUrl}/api/auth/callback`,
    cookiePassword,
    cookieName,
    cookieSameSite: "lax",
    apiHostname: "127.0.0.1",
    apiPort: workosPort,
    apiHttps: false,
  });

  const config = getConfigurationProvider().getConfig();
  const core = new AuthKitCore(config, getWorkOS(), sessionEncryption);
  return core.encryptSession({
    accessToken,
    refreshToken: "refresh_lighthouse_a11y",
    user: {
      object: "user",
      id: workosUserId,
      email: `${workosUserId}@example.test`,
      emailVerified: true,
      profilePictureUrl: null,
      firstName: "Lighthouse",
      lastName: "A11y",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

async function assertDashboardReady(sessionCookie) {
  const response = await fetch(dashboardUrl, {
    headers: {
      cookie: `${cookieName}=${encodeURIComponent(sessionCookie)}`,
      accept: "text/html",
    },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `/dashboard redirected to ${response.headers.get("location") ?? "sign-in"} instead of rendering authed chrome`,
    );
  }
  if (!response.ok) {
    throw new Error(`/dashboard returned ${response.status}: ${await response.text()}`);
  }
  const html = await response.text();
  if (!html.includes("Overview of recent artifacts, audit events, and usage policy.")) {
    throw new Error("/dashboard did not render the authenticated PageHeader");
  }
  if (!html.includes("No artifacts published yet.") && !html.includes("Nothing here yet.")) {
    throw new Error("/dashboard did not render an empty dashboard surface");
  }
}

function spawnChild(command, args, env = {}, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let spawnError = null;
  const appendLog = (chunk) => {
    log += chunk.toString();
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.once("error", (error) => {
    spawnError = error;
    appendLog(`\n[spawn error] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  });
  child.__log = () => log;
  child.__spawnError = () => spawnError;
  children.push(child);
  return child;
}

async function shutdownChildren() {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(1000)]).catch(() => undefined);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([once(child, "exit"), delay(1000)]).catch(() => undefined);
    }
  }
}

async function waitForHealthy(url, headers, child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  const attemptTimeoutMs = Math.min(5_000, Math.max(500, Math.floor(timeoutMs / 10)));
  while (Date.now() - startedAt < timeoutMs) {
    const spawnError = child.__spawnError?.();
    if (spawnError) {
      throw new Error(
        `process failed to start: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}\n${child.__log?.() ?? ""}`,
      );
    }
    if (child.exitCode !== null) {
      throw new Error(`process exited early\n${child.__log?.() ?? ""}`);
    }
    const controller = new AbortController();
    const attemptTimer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting or this probe timed out.
    } finally {
      clearTimeout(attemptTimer);
    }
    await delay(200);
  }
  throw new Error(`service did not become healthy at ${url}\n${child.__log?.() ?? ""}`);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
