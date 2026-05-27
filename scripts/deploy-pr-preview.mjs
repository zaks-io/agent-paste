#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ensureJobQueues } from "./ensure-job-queues.mjs";
import { prPreviewJobQueues } from "./pr-preview-job-queues.mjs";

const prNumber = requiredEnv("PR_NUMBER");
const hyperdriveId = requiredEnv("PR_HYPERDRIVE_ID");
const workersSubdomain = requiredEnv("CLOUDFLARE_WORKERS_SUBDOMAIN");
const outDir = new URL(`../.wrangler/pr-preview/pr-${prNumber}/`, import.meta.url);
const jobQueues = prPreviewJobQueues(prNumber);

const names = {
  api: `agent-paste-api-pr-${prNumber}`,
  upload: `agent-paste-upload-pr-${prNumber}`,
  content: `agent-paste-content-pr-${prNumber}`,
  jobs: `agent-paste-jobs-pr-${prNumber}`,
  apex: `agent-paste-apex-pr-${prNumber}`,
  web: `agent-paste-web-pr-${prNumber}`,
};
// The web OAuth callback must live under our own domain: WorkOS rejects wildcard
// redirect URIs on public-suffix hosts like *.workers.dev, and a one-time
// *.preview.agent-paste.sh redirect URI is registered in the preview WorkOS env.
const webHost = `pr-${prNumber}.preview.agent-paste.sh`;
const urls = {
  api: `https://${names.api}.${workersSubdomain}.workers.dev`,
  upload: `https://${names.upload}.${workersSubdomain}.workers.dev`,
  content: `https://${names.content}.${workersSubdomain}.workers.dev`,
  jobs: `https://${names.jobs}.${workersSubdomain}.workers.dev`,
  apex: `https://${names.apex}.${workersSubdomain}.workers.dev`,
  // Custom domain carries the real OAuth callback (cert issues async, minutes).
  web: `https://${webHost}`,
  // workers.dev host serves immediately; the smoke targets it to avoid the
  // custom-domain cert-propagation race.
  webWorkersDev: `https://${names.web}.${workersSubdomain}.workers.dev`,
};
const prSecrets = createPrSecrets();

mkdirSync(outDir, { recursive: true });

const files = {
  apiConfig: new URL("api.json", outDir).pathname,
  uploadConfig: new URL("upload.json", outDir).pathname,
  contentConfig: new URL("content.json", outDir).pathname,
  apexConfig: new URL("apex.json", outDir).pathname,
  jobsConfig: new URL("jobs.json", outDir).pathname,
  apiSecrets: new URL("api.secrets.json", outDir).pathname,
  uploadSecrets: new URL("upload.secrets.json", outDir).pathname,
  contentSecrets: new URL("content.secrets.json", outDir).pathname,
  jobsSecrets: new URL("jobs.secrets.json", outDir).pathname,
};

writeJson(files.apiConfig, apiConfig());
writeJson(files.uploadConfig, uploadConfig());
writeJson(files.contentConfig, contentConfig());
writeJson(files.jobsConfig, jobsConfig());
writeJson(files.apexConfig, apexConfig());
writeJson(files.apiSecrets, pickSecrets(["CONTENT_SIGNING_SECRET", "API_KEY_PEPPER_V1", "SMOKE_HARNESS_SECRET"]));
writeJson(files.uploadSecrets, pickSecrets(["CONTENT_SIGNING_SECRET", "UPLOAD_SIGNING_SECRET", "API_KEY_PEPPER_V1"]));
writeJson(files.contentSecrets, pickSecrets(["CONTENT_SIGNING_SECRET"]));
writeJson(files.jobsSecrets, pickSecrets(["SMOKE_HARNESS_SECRET"]));

await ensurePreviewJobQueues();
await deploy("api", files.apiConfig, files.apiSecrets);
await deploy("upload", files.uploadConfig, files.uploadSecrets);
await deploy("content", files.contentConfig, files.contentSecrets);
await deploy("jobs", files.jobsConfig, files.jobsSecrets);
await deploy("apex", files.apexConfig);
const webDeployed = await deployWeb();

emitOutput("api_url", urls.api);
emitOutput("upload_url", urls.upload);
emitOutput("content_url", urls.content);
emitOutput("jobs_url", urls.jobs);
emitOutput("apex_url", urls.apex);
if (webDeployed) {
  emitOutput("web_url", urls.web);
  emitOutput("web_smoke_url", urls.webWorkersDev);
}
emitOutput("smoke_harness_secret", prSecrets.SMOKE_HARNESS_SECRET);

process.stdout.write(`PR preview deployed:
API:     ${urls.api}
Upload:  ${urls.upload}
Content: ${urls.content}
Jobs:    ${urls.jobs}
Apex:    ${urls.apex}
${webDeployed ? `Web:     ${urls.web} (smoke: ${urls.webWorkersDev})\n` : "Web:     skipped (WORKOS_PREVIEW_API_KEY unset)\n"}`);

async function ensurePreviewJobQueues() {
  process.stdout.write(`Ensuring PR-scoped preview Cloudflare Queues exist for PR ${prNumber}...\n`);
  await ensureJobQueues(jobQueues.creationOrder, { run });
}

async function deploy(app, configPath, secretsPath) {
  process.stdout.write(`Deploying ${names[app]}...\n`);
  await run("pnpm", ["exec", "wrangler", "deploy", "--config", configPath]);
  if (secretsPath) {
    await run("pnpm", ["exec", "wrangler", "secret", "bulk", secretsPath, "--name", names[app]]);
  }
}

// web is a TanStack Start build, not a bundle-from-src worker: building with
// CLOUDFLARE_ENV=preview emits dist/server/wrangler.json (main: index.js, assets:
// ../client) resolved from the preview env block. We patch only the per-PR fields
// and deploy that generated config so main/asset resolution stays the plugin's job.
// Fail-soft: a PR without WORKOS_PREVIEW_API_KEY skips web rather than wedging the
// whole preview (the api/upload/content/apex secrets are all seed-derived).
async function deployWeb() {
  const workosApiKey = process.env.WORKOS_PREVIEW_API_KEY;
  if (!workosApiKey) {
    process.stdout.write("WORKOS_PREVIEW_API_KEY unset; skipping per-PR web deploy.\n");
    return false;
  }
  if (process.env.GITHUB_ACTIONS) {
    process.stdout.write(`::add-mask::${workosApiKey}\n`);
  }
  process.stdout.write(`Deploying ${names.web}...\n`);

  // CLOUDFLARE_ENV picks the preview env block the vite plugin resolves into
  // dist/server/wrangler.json. Scope it to the build only: if it leaked into the
  // deploy/secret commands below, wrangler would append "-preview" to the worker
  // name and deploy/seed the wrong worker.
  await run("pnpm", ["--filter", "@agent-paste/web", "build"], { env: { CLOUDFLARE_ENV: "preview" } });

  const generatedConfig = workspacePath("apps/web/dist/server/wrangler.json");
  const config = JSON.parse(readFileSync(generatedConfig, "utf8"));
  config.name = names.web;
  config.workers_dev = true;
  config.routes = [{ pattern: webHost, custom_domain: true }];
  config.vars = {
    ...config.vars,
    API_BASE_URL: urls.api,
    WEB_BASE_URL: urls.web,
    WORKOS_REDIRECT_URI: `${urls.web}/api/auth/callback`,
  };
  config.services = [{ binding: "API", service: names.api }];
  writeJson(generatedConfig, config);

  await run("pnpm", ["exec", "wrangler", "deploy", "--config", generatedConfig]);

  const webSecretsPath = new URL("web.secrets.json", outDir).pathname;
  writeJson(webSecretsPath, {
    WORKOS_API_KEY: workosApiKey,
    WORKOS_COOKIE_PASSWORD: prSecrets.WORKOS_COOKIE_PASSWORD,
  });
  await run("pnpm", ["exec", "wrangler", "secret", "bulk", webSecretsPath, "--name", names.web]);
  return true;
}

function apiConfig() {
  return baseConfig("api", {
    main: workspacePath("apps/api/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    vars: {
      API_KEY_ENV: "preview",
      API_BASE_URL: urls.api,
      CONTENT_BASE_URL: urls.content,
      CLEANUP_BATCH_SIZE: "100",
      AGENT_PASTE_ENV: "preview",
    },
    hyperdrive: [{ binding: "DB", id: hyperdriveId }],
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "agent-paste-artifacts-preview" }],
    kv_namespaces: [{ binding: "DENYLIST", id: "5780695433d4494897dcbb78bcb4f180" }],
    ratelimits: [
      rateLimit("ACTOR_RATE_LIMIT", `4${prNumber}001`, 60, 60),
      rateLimit("WORKSPACE_BURST_CAP", `4${prNumber}002`, 300, 10),
    ],
    queues: {
      producers: [{ queue: jobQueues.bundleGenerate, binding: "BUNDLE_GENERATE_QUEUE" }],
    },
  });
}

function uploadConfig() {
  return baseConfig("upload", {
    main: workspacePath("apps/upload/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    vars: {
      API_KEY_ENV: "preview",
      API_BASE_URL: urls.api,
      CONTENT_BASE_URL: urls.content,
      UPLOAD_BASE_URL: urls.upload,
      UPLOAD_URL_TTL_SECONDS: "900",
      AGENT_PASTE_ENV: "preview",
    },
    hyperdrive: [{ binding: "DB", id: hyperdriveId }],
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "agent-paste-artifacts-preview" }],
    ratelimits: [
      rateLimit("ACTOR_RATE_LIMIT", `4${prNumber}011`, 60, 60),
      rateLimit("WORKSPACE_BURST_CAP", `4${prNumber}012`, 300, 10),
    ],
  });
}

function contentConfig() {
  return baseConfig("content", {
    main: workspacePath("apps/content/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    vars: {
      CONTENT_SIGNING_KID: "v1",
      AGENT_PASTE_ENV: "preview",
    },
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "agent-paste-artifacts-preview" }],
    kv_namespaces: [{ binding: "DENYLIST", id: "5780695433d4494897dcbb78bcb4f180" }],
    ratelimits: [rateLimit("ARTIFACT_RATE_LIMIT", `4${prNumber}003`, 60, 60)],
  });
}

function jobsConfig() {
  return baseConfig("jobs", {
    main: workspacePath("apps/jobs/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    triggers: { crons: ["*/15 * * * *", "0 * * * *"] },
    vars: {
      AGENT_PASTE_ENV: "preview",
      JOBS_ENABLED: "true",
      SMOKE_SYNC_BYTE_PURGE: "true",
    },
    hyperdrive: [{ binding: "DB", id: hyperdriveId }],
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "agent-paste-artifacts-preview" }],
    kv_namespaces: [{ binding: "DENYLIST", id: "5780695433d4494897dcbb78bcb4f180" }],
    queues: {
      producers: [
        { queue: jobQueues.bytePurge, binding: "BYTE_PURGE_QUEUE" },
        { queue: jobQueues.safetyScan, binding: "SAFETY_SCAN_QUEUE" },
        { queue: jobQueues.bundleGenerate, binding: "BUNDLE_GENERATE_QUEUE" },
      ],
      consumers: [
        {
          queue: jobQueues.bytePurge,
          max_batch_size: 50,
          max_retries: 3,
          dead_letter_queue: jobQueues.bytePurgeDlq,
        },
        {
          queue: jobQueues.safetyScan,
          max_batch_size: 1,
          max_retries: 3,
          dead_letter_queue: jobQueues.safetyScanDlq,
        },
        {
          queue: jobQueues.bundleGenerate,
          max_batch_size: 1,
          max_retries: 5,
          dead_letter_queue: jobQueues.bundleGenerateDlq,
        },
        {
          queue: jobQueues.bundleGenerateDlq,
          max_batch_size: 10,
        },
      ],
    },
  });
}

function apexConfig() {
  return baseConfig("apex", {
    main: workspacePath("apps/apex/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    assets: {
      binding: "ASSETS",
      directory: workspacePath("apps/apex/public"),
      not_found_handling: "none",
      run_worker_first: true,
    },
    vars: {
      AGENT_PASTE_ENV: "preview",
    },
  });
}

function baseConfig(app, config) {
  return {
    $schema: workspacePath("node_modules/wrangler/config-schema.json"),
    name: names[app],
    compatibility_date: "2026-05-21",
    workers_dev: true,
    observability: { enabled: true },
    ...config,
  };
}

function rateLimit(name, namespaceId, limit, period) {
  return {
    name,
    namespace_id: namespaceId.slice(0, 32),
    simple: { limit, period },
  };
}

function pickSecrets(names) {
  const values = {};
  for (const name of names) {
    values[name] = prSecrets[name];
  }
  return values;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function emitOutput(name, value) {
  process.stdout.write(`${name}=${value}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = options.env ? { ...process.env, ...options.env } : process.env;
    const child = spawn(command, args, { stdio: options.allowFailure ? ["ignore", "pipe", "pipe"] : "inherit", env });
    let stdout = "";
    let stderr = "";
    if (options.allowFailure) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      if (exitCode === 0 || options.allowFailure) {
        if (options.allowFailure) {
          if (stdout.trim()) {
            process.stdout.write(stdout);
          }
          if (stderr.trim()) {
            process.stderr.write(stderr);
          }
        }
        resolve({ code: exitCode, stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${exitCode}`));
    });
  });
}

function requiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Set ${name}.`);
  }
  return value;
}

function workspacePath(path) {
  return new URL(`../${path}`, import.meta.url).pathname;
}

function createPrSecrets() {
  const apiKeyPepper = process.env.PREVIEW_API_KEY_PEPPER_V1 ?? prPreviewSecret("api-key-pepper");
  const smokeHarnessSecret =
    process.env.AGENT_PASTE_PR_SMOKE_HARNESS_SECRET ??
    process.env.AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET ??
    prPreviewSecret("smoke-harness", 32);
  const values = {
    CONTENT_SIGNING_SECRET: process.env.PREVIEW_CONTENT_SIGNING_SECRET ?? prPreviewSecret("content-signing"),
    UPLOAD_SIGNING_SECRET: process.env.PREVIEW_UPLOAD_SIGNING_SECRET ?? prPreviewSecret("upload-signing"),
    API_KEY_PEPPER_V1: apiKeyPepper,
    SMOKE_HARNESS_SECRET: smokeHarnessSecret,
    // AuthKit seals its session cookie with this; 32+ chars required. Derived so
    // a PR's web worker can decrypt cookies it set on an earlier deploy.
    WORKOS_COOKIE_PASSWORD: process.env.PREVIEW_WORKOS_COOKIE_PASSWORD ?? prPreviewSecret("workos-cookie-password", 32),
  };
  if (process.env.GITHUB_ACTIONS) {
    for (const value of Object.values(values)) {
      process.stdout.write(`::add-mask::${value}\n`);
    }
  }
  return values;
}

function prPreviewSecret(label, byteLength = 48) {
  const seed = process.env.PR_PREVIEW_SECRET_SEED;
  if (!seed) {
    return secretBytes(byteLength);
  }
  const encodedLength = Math.ceil((byteLength * 4) / 3);
  return createHmac("sha512", seed)
    .update(`agent-paste:pr-preview:${prNumber}:${label}`)
    .digest("base64url")
    .slice(0, encodedLength);
}

function secretBytes(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}
