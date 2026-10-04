#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, cp } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLocalEnvSecrets } from "./lib/local-env-secrets.mjs";
import { loadEnvFiles } from "./lib/load-env-files.mjs";
import { startLocalCloudflareProxies } from "./lib/local-cloudflare-proxy.mjs";
import { startLocalCloudflareAuth } from "./lib/local-cloudflare-auth.mjs";
import { waitForHealthz } from "./smoke-harness.mjs";
import { writeLocalWorker, writeLocalGateway } from "./lib/local-cloudflare-worker.mjs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(root, ".wrangler/local-cloudflare");
const runtimeUrl = "postgres://app_role:agent-paste-local-app-role@127.0.0.1:5432/agent_paste";
const ports = { api: 8787, upload: 8788, content: 8789, jobs: 8790, mcp: 8792, web: 5173, apex: 5174 };
const webBaseUrl = process.env.AGENT_PASTE_LOCAL_WEB_URL ?? "http://localhost:5173";
const contentBaseUrl = process.env.AGENT_PASTE_LOCAL_CONTENT_URL ?? "http://127.0.0.1:8789";
const children = new Set();
let proxies = [];
let auth;
let stopping = false;
let shutdownPromise;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    void shutdown();
  });
}

if (Number(process.versions.node.split(".")[0]) !== 24) {
  throw new Error("Use Node 24 from .nvmrc before starting local Cloudflare.");
}

try {
  const portProbe = createServer();
  portProbe.listen(8799, "127.0.0.1");
  await once(portProbe, "listening");
  await new Promise((done) => portProbe.close(done));
  await run("pnpm", ["build", "--concurrency=2"]);
  // Vite's generated Wrangler config contains absolute worktree paths.
  await run("pnpm", ["--filter", "@agent-paste/web", "build"]);
  await run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  await run("pnpm", ["--filter", "@agent-paste/db", "migrate"], {
    DATABASE_URL: "postgres://agent_paste:agent_paste@127.0.0.1:5432/agent_paste",
    DATABASE_RUNTIME_ROLE_PASSWORD: "agent-paste-local-app-role",
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretsPath = resolve(directory, ".env");
  ensureLocalEnvSecrets(secretsPath);
  const local = {};
  loadEnvFiles([secretsPath], { env: local });
  auth = await startLocalCloudflareAuth(local.AGENT_PASTE_ACCESS_LINK_SIGNING_KEY);
  const secrets = {
    API_KEY_PEPPER_V1: local.AGENT_PASTE_API_KEY_PEPPER,
    UPLOAD_SIGNING_SECRET: local.AGENT_PASTE_UPLOAD_SIGNING_SECRET,
    CONTENT_SIGNING_SECRET: local.AGENT_PASTE_CONTENT_SIGNING_SECRET,
    ARTIFACT_BYTES_ENCRYPTION_KEY: local.AGENT_PASTE_ARTIFACT_BYTES_ENCRYPTION_KEY,
    SMOKE_HARNESS_SECRET: local.SMOKE_HARNESS_SECRET,
    ...auth.vars,
    WORKOS_MCP_AUDIENCE: "http://127.0.0.1:8792/",
  };
  const configs = [];
  let apexConfig;
  const rateLimits = [];
  const sourcePaths = Object.keys(ports).map((app) =>
    resolve(root, `apps/${app}/${app === "web" ? "dist/server/wrangler.json" : "wrangler.jsonc"}`),
  );
  // Wrangler's module installs signal handlers that exit before our child cleanup.
  const sources = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {experimental_readRawConfig} from 'wrangler'; process.stdout.write(JSON.stringify(process.argv.slice(1).map(config => experimental_readRawConfig({config}).rawConfig)));",
        ...sourcePaths,
      ],
      { cwd: root, env: localProcessEnv(), encoding: "utf8" },
    ),
  );
  for (const [app, port] of Object.entries(ports)) {
    const built = app === "web";
    const source = sources[Object.keys(ports).indexOf(app)];
    const config = {
      name: source.name,
      main: resolve(root, `apps/${app}/${built ? "dist/server" : ""}`, source.main),
      compatibility_date: source.compatibility_date,
      compatibility_flags: source.compatibility_flags,
      dev: { ip: "127.0.0.1", port, inspector_port: 0 },
      vars: {
        ...source.vars,
        AGENT_PASTE_ENV: "dev",
        API_BASE_URL: "http://127.0.0.1:8787",
        UPLOAD_BASE_URL: "http://127.0.0.1:8788",
        CONTENT_BASE_URL: contentBaseUrl,
        EPHEMERAL_PROVISION_DELAY_MS: "0",
        MCP_RESOURCE: "http://127.0.0.1:8792/",
        MCP_AUTHORIZATION_SERVER: auth.vars.WORKOS_API_BASE_URL,
        WORKOS_MCP_AUDIENCE: "http://127.0.0.1:8792/",
        WEB_BASE_URL: webBaseUrl,
        WORKOS_REDIRECT_URI: `${webBaseUrl}/api/auth/callback`,
        WORKOS_CLIENT_ID: auth.vars.WORKOS_CLIENT_ID,
      },
      r2_buckets: source.r2_buckets,
      // The checked-in dev placeholders collide across unrelated KV namespaces.
      kv_namespaces: source.kv_namespaces?.map((binding) => ({ ...binding, id: binding.binding.toLowerCase() })),
      durable_objects: source.durable_objects,
      migrations: source.migrations,
      ratelimits: source.ratelimits,
      queues: source.queues ?? {
        producers:
          source.env?.preview?.queues?.producers?.map((binding) => ({
            ...binding,
            queue: binding.queue.replace(/-preview$/, ""),
          })) ?? [],
      },
      ...(source.assets
        ? {
            assets: {
              ...source.assets,
              directory: resolve(root, `apps/${app}/${built ? "dist/server" : ""}`, source.assets.directory),
            },
          }
        : {}),
      ...(app === "mcp" ? { services: source.services } : {}),
      ...(!["api", "upload", "jobs"].includes(app)
        ? {}
        : {
            hyperdrive: [{ binding: "DB", id: "00000000000000000000000000000000", localConnectionString: runtimeUrl }],
          }),
    };
    const appDirectory = resolve(directory, app);
    await mkdir(appDirectory, { recursive: true, mode: 0o700 });
    if (built) {
      await cp(resolve(root, "apps/web/dist/server"), resolve(appDirectory, "server"), {
        recursive: true,
        filter: (path) => !basename(path).startsWith(".") && basename(path) !== "wrangler.json",
      });
      config.main = resolve(appDirectory, "server/index.js");
      config.no_bundle = source.no_bundle;
      config.rules = source.rules;
    }
    rateLimits.push(...(config.ratelimits ?? []).map((binding) => ({ ...binding, name: `${app}_${binding.name}` })));
    await writeLocalWorker(app, appDirectory, config);
    const configPath = resolve(appDirectory, "wrangler.json");
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(
      resolve(appDirectory, ".dev.vars"),
      Object.entries(secrets)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n"),
      { mode: 0o600 },
    );
    if (app === "apex") apexConfig = configPath;
    else configs.push(configPath);
  }
  // Miniflare 4.20260521 shares one asset disk service across Workers; keep apex's
  // assets in a separate runtime so they cannot shadow the dashboard's assets.
  const fleetPorts = Object.fromEntries(Object.entries(ports).filter(([app]) => app !== "apex"));
  const gatewayConfig = await writeLocalGateway(directory, Object.keys(fleetPorts), rateLimits);
  proxies = await startLocalCloudflareProxies(fleetPorts, 8799);
  const apex = start("pnpm", ["exec", "wrangler", "dev", "-c", apexConfig, "--local", "--log-level", "warn"]);
  const wrangler = start("pnpm", [
    "exec",
    "wrangler",
    "dev",
    "-c",
    gatewayConfig,
    ...configs.flatMap((config) => ["-c", config]),
    "--local",
    "--persist-to",
    resolve(directory, "state"),
    "--log-level",
    "warn",
  ]);
  const workerExit = Promise.race([once(wrangler, "exit"), once(apex, "exit")]);
  const unexpectedExit = workerExit.then(([code, signal]) => {
    if (!stopping) throw new Error(`Wrangler exited ${signal ?? code}`);
  });
  await Promise.race([
    unexpectedExit,
    Promise.all(
      ["api", "upload", "content", "jobs", "mcp", "web"].map((app) =>
        waitForHealthz(`http://127.0.0.1:${ports[app]}`, { timeoutMs: 60000, sleepMs: 250 }),
      ),
    ),
  ]);
  const apexResponse = await fetch("http://127.0.0.1:5174/");
  if (!apexResponse.ok) throw new Error(`Local marketing Worker failed (${apexResponse.status}).`);
  const callback = await fetch("http://127.0.0.1:8787/v1/auth/web/callback", {
    method: "POST",
    headers: { authorization: `Bearer ${auth.accessToken}` },
  });
  if (!callback.ok) throw new Error(`Local WorkOS fixture provisioning failed (${callback.status}).`);
  await writeFile(
    resolve(directory, "auth.json"),
    JSON.stringify({ accessToken: auth.accessToken, mcpToken: auth.mcpToken }),
    { mode: 0o600 },
  );
  process.stdout.write(
    "Local Cloudflare ready: Web 5173, Apex 5174, API 8787, Upload 8788, Content 8789, Jobs 8790, MCP 8792.\nSign in uses a local WorkOS fixture. State and independent secrets: .wrangler/local-cloudflare/\n",
  );
  await unexpectedExit;
} catch (error) {
  if (!stopping) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} finally {
  await shutdown();
}

function shutdown() {
  shutdownPromise ??= (async () => {
    for (const server of proxies) server.close();
    auth?.server.close();
    const groups = [...children].map((child) => child.pid);
    const signalGroups = (signal) => {
      for (const pid of groups) {
        try {
          process.kill(-pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    };
    signalGroups("SIGTERM");
    await delay(1000);
    signalGroups("SIGKILL");
  })();
  return shutdownPromise;
}

function localProcessEnv() {
  // Do not inherit hosted credentials or app dotenv files into the local fleet.
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "TERM", "LANG", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
}

function start(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...localProcessEnv(), ...extraEnv },
    stdio: "inherit",
    detached: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function run(command, args, env) {
  const child = start(command, args, env);
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} failed (${signal ?? code}).`);
}
