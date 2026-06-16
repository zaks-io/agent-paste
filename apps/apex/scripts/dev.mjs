#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const DEFAULT_PORT = 5174;
const ENV_DEFAULTS = {
  dev: { AGENT_PASTE_ENV: "dev", BILLING_ENABLED: "false" },
  preview: { AGENT_PASTE_ENV: "preview", BILLING_ENABLED: "true" },
  production: { AGENT_PASTE_ENV: "production", BILLING_ENABLED: "false" },
};
const DEV_ASSETS = { cssHref: "/src/styles/apex.css", jsHref: "/src/client.ts" };

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "preview" },
    host: { type: "string" },
    port: { type: "string" },
  },
});

const envName = values.env;
if (!Object.hasOwn(ENV_DEFAULTS, envName)) {
  throw new Error(`Unsupported apex preview env "${envName}". Use dev, preview, or production.`);
}
for (const [name, value] of Object.entries(ENV_DEFAULTS[envName])) {
  process.env[name] ??= value;
}

const host = values.host ?? process.env.HOST ?? "127.0.0.1";
const port = Number(values.port ?? process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid apex preview port: ${values.port ?? process.env.PORT}`);
}

const vite = await createServer({
  root,
  appType: "custom",
  server: { host, port },
  plugins: [apexPreviewPlugin()],
});

await vite.listen();
vite.printUrls();
console.log(`apex preview: local preview defaults active on ${host}:${port}`);

function apexPreviewPlugin() {
  return {
    name: "apex-preview",
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          try {
            await handleRequest(server, req, res, next);
          } catch (error) {
            server.ssrFixStacktrace(error);
            console.error(error);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("content-type", "text/plain; charset=utf-8");
            }
            res.end(error instanceof Error ? error.stack : String(error));
          }
        });
      };
    },
    handleHotUpdate({ file, server }) {
      if (shouldFullReload(file)) {
        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
    },
  };
}

async function handleRequest(server, req, res, next) {
  const url = requestUrl(req);
  if (!url) {
    next();
    return;
  }

  if (await serveWorkerOnlyRoute(server, req, res, url)) {
    return;
  }

  const [{ render, ROUTE_PATHS }, { apexSecurityHeaders }] = await Promise.all([
    server.ssrLoadModule("/src/entry-server.tsx"),
    server.ssrLoadModule("/src/security-headers.ts"),
  ]);
  const routePath = normalizeRoutePath(url.pathname);
  if (!ROUTE_PATHS.includes(routePath)) {
    await serveWorkerFallback(server, req, res, url);
    return;
  }

  const html = await server.transformIndexHtml(url.pathname, render(routePath, DEV_ASSETS));
  res.statusCode = 200;
  setNodeHeaders(res, devSecurityHeaders(apexSecurityHeaders()));
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(req.method === "HEAD" ? undefined : html);
}

async function serveWorkerOnlyRoute(server, req, res, url) {
  const [{ handleRequest: handleWorkerRequest, isTextAssetPath }, { productRedirect }] = await Promise.all([
    server.ssrLoadModule("/src/server.ts"),
    server.ssrLoadModule("/src/redirects.ts"),
  ]);
  const method = req.method ?? "GET";
  const workerOwnsRoute =
    (method !== "GET" && method !== "HEAD") ||
    url.pathname === "/healthz" ||
    isTextAssetPath(url.pathname) ||
    Boolean(productRedirect(url));
  if (!workerOwnsRoute) {
    return false;
  }
  const response = await handleWorkerRequest(toFetchRequest(req, url), workerEnv());
  await writeFetchResponse(res, response, method);
  return true;
}

async function serveWorkerFallback(server, req, res, url) {
  const { handleRequest: handleWorkerRequest } = await server.ssrLoadModule("/src/server.ts");
  const method = req.method ?? "GET";
  const response = await handleWorkerRequest(toFetchRequest(req, url), workerEnv());
  await writeFetchResponse(res, response, method);
}

function workerEnv() {
  return {
    AGENT_PASTE_ENV: process.env.AGENT_PASTE_ENV,
    BILLING_ENABLED: process.env.BILLING_ENABLED,
    CF_WEB_ANALYTICS_TOKEN: process.env.CF_WEB_ANALYTICS_TOKEN,
    ASSETS: {
      fetch: localAssetFetch,
    },
  };
}

async function localAssetFetch(request) {
  const url = new URL(request.url);
  const assetPath = publicAssetPath(url.pathname);
  if (!assetPath) {
    return new Response("not_found", { status: 404 });
  }

  try {
    const body = await readFile(assetPath);
    return new Response(body, { headers: { "content-type": contentType(assetPath) } });
  } catch {
    return new Response("not_found", { status: 404 });
  }
}

function publicAssetPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/^\/+/, "");
  const candidates =
    normalized === ""
      ? []
      : normalized.includes(".")
        ? [normalized]
        : [normalized.endsWith("/") ? `${normalized}index.html` : `${normalized}/index.html`];
  for (const candidate of candidates) {
    const assetPath = resolve(publicRoot, candidate);
    if (assetPath === publicRoot || assetPath.startsWith(`${publicRoot}${sep}`)) {
      return assetPath;
    }
  }
  return null;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function requestUrl(req) {
  if (!req.url) {
    return null;
  }
  const hostHeader = req.headers.host ?? `${host}:${port}`;
  return new URL(req.url, `http://${hostHeader}`);
}

function toFetchRequest(req, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value) {
      headers.set(name, value);
    }
  }
  return new Request(url.href, { method: req.method ?? "GET", headers });
}

async function writeFetchResponse(res, response, method) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

function setNodeHeaders(res, headers) {
  new Headers(headers).forEach((value, name) => {
    res.setHeader(name, value);
  });
}

// Vite's dev middleware injects an inline React-refresh preamble and HMR client
// (plus inline styles) that the strict production CSP blocks, which stops the app
// from hydrating. This relaxes ONLY the CSP, ONLY in this dev server, so the local
// preview is actually interactive. Production headers (src/security-headers.ts) and
// their tests are untouched: nothing here runs in the deployed Worker.
function devSecurityHeaders(headers) {
  const relaxed = new Headers(headers);
  relaxed.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data:",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "connect-src 'self' ws: wss: https://cloudflareinsights.com",
    ].join("; "),
  );
  return relaxed;
}

function normalizeRoutePath(pathname) {
  return pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function shouldFullReload(file) {
  const rel = relative(root, file).split(sep).join("/");
  if (rel === "src/styles/apex.css") {
    return false;
  }
  return (
    rel.startsWith("src/") ||
    rel.startsWith("public/") ||
    (/^\.\.\/\.\.\/packages\//.test(rel) && /\.(mjs|js|jsx|ts|tsx)$/.test(rel))
  );
}
