import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const root = resolve(import.meta.dirname, "..");
const clientDir = resolve(root, "apps/apex/dist/client");
const serverEntry = resolve(root, "apps/apex/dist/server/entry-server.js");
const minScore = Number(process.env.AGENT_PASTE_LIGHTHOUSE_APEX_A11Y_MIN_SCORE ?? "100");

if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
  throw new Error("AGENT_PASTE_LIGHTHOUSE_APEX_A11Y_MIN_SCORE must be a number between 0 and 100");
}

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

async function assertBuilt() {
  try {
    await access(resolve(clientDir, "index.html"));
    await access(serverEntry);
  } catch {
    throw new Error("apps/apex is not built; run `pnpm --filter @agent-paste/apex build` first");
  }
}

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const rel = normalize(decoded.replace(/^\/+/, ""));
  const candidate = resolve(clientDir, rel);
  if (candidate !== clientDir && !candidate.startsWith(`${clientDir}${sep}`)) {
    return null;
  }
  return candidate;
}

async function fileForPath(pathname) {
  const candidate = safePath(pathname);
  if (!candidate) {
    return null;
  }
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      return resolve(candidate, "index.html");
    }
    return candidate;
  } catch {
    if (!extname(candidate)) {
      const indexFile = join(candidate, "index.html");
      try {
        await access(indexFile);
        return indexFile;
      } catch {}
    }
    return null;
  }
}

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const file = await fileForPath(url.pathname);
      if (!file) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": TYPES.get(extname(file)) ?? "application/octet-stream" });
      await pipeline(createReadStream(file), response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    }
  });
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("could not resolve local server port"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function failedAudits(lhr) {
  return Object.values(lhr.audits)
    .filter((audit) => audit.score !== null && audit.score !== 1 && audit.scoreDisplayMode !== "notApplicable")
    .map((audit) => audit.id);
}

await assertBuilt();

const { ROUTE_PATHS } = await import(pathToFileURL(serverEntry).href);
const server = createStaticServer();
const port = await listen(server);
const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
const failures = [];

try {
  for (const path of ROUTE_PATHS) {
    const result = await lighthouse(`http://127.0.0.1:${port}${path}`, {
      port: chrome.port,
      onlyCategories: ["accessibility"],
      output: "json",
      logLevel: "error",
      disableStorageReset: true,
    });
    const lhr = result?.lhr;
    const rawScore = (lhr?.categories?.accessibility?.score ?? 0) * 100;
    const score = Math.round(rawScore);
    const audits = lhr ? failedAudits(lhr) : ["missing-lighthouse-result"];
    process.stdout.write(`${path}: ${score}${audits.length ? ` (${audits.join(", ")})` : ""}\n`);
    if (!lhr || rawScore < minScore) {
      failures.push({ path, score, audits });
    }
  }
} finally {
  await chrome.kill();
  await close(server);
}

if (failures.length > 0) {
  const summary = failures.map((failure) => `${failure.path}=${failure.score}`).join(", ");
  throw new Error(`apex accessibility gate failed: ${summary}`);
}

process.stdout.write(`Apex Lighthouse accessibility gate passed (${ROUTE_PATHS.length} routes >= ${minScore}).\n`);
