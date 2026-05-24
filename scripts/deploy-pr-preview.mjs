#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const prNumber = requiredEnv("PR_NUMBER");
const hyperdriveId = requiredEnv("PR_HYPERDRIVE_ID");
const workersSubdomain = requiredEnv("CLOUDFLARE_WORKERS_SUBDOMAIN");
const outDir = new URL(`../.wrangler/pr-preview/pr-${prNumber}/`, import.meta.url);

const names = {
  api: `agent-paste-api-pr-${prNumber}`,
  upload: `agent-paste-upload-pr-${prNumber}`,
  content: `agent-paste-content-pr-${prNumber}`,
  apex: `agent-paste-apex-pr-${prNumber}`,
};
const urls = {
  api: `https://${names.api}.${workersSubdomain}.workers.dev`,
  upload: `https://${names.upload}.${workersSubdomain}.workers.dev`,
  content: `https://${names.content}.${workersSubdomain}.workers.dev`,
  apex: `https://${names.apex}.${workersSubdomain}.workers.dev`,
};
const prSecrets = createPrSecrets();

mkdirSync(outDir, { recursive: true });

const files = {
  apiConfig: new URL("api.json", outDir).pathname,
  uploadConfig: new URL("upload.json", outDir).pathname,
  contentConfig: new URL("content.json", outDir).pathname,
  apexConfig: new URL("apex.json", outDir).pathname,
  apiSecrets: new URL("api.secrets.json", outDir).pathname,
  uploadSecrets: new URL("upload.secrets.json", outDir).pathname,
  contentSecrets: new URL("content.secrets.json", outDir).pathname,
};

writeJson(files.apiConfig, apiConfig());
writeJson(files.uploadConfig, uploadConfig());
writeJson(files.contentConfig, contentConfig());
writeJson(files.apexConfig, apexConfig());
writeJson(
  files.apiSecrets,
  pickSecrets(["CONTENT_SIGNING_SECRET", "API_KEY_PEPPER_V1", "ADMIN_TOKEN_HASH", "OPERATOR_EMAILS"]),
);
writeJson(files.uploadSecrets, pickSecrets(["CONTENT_SIGNING_SECRET", "UPLOAD_SIGNING_SECRET", "API_KEY_PEPPER_V1"]));
writeJson(files.contentSecrets, pickSecrets(["CONTENT_SIGNING_SECRET"]));

await deploy("api", files.apiConfig, files.apiSecrets);
await deploy("upload", files.uploadConfig, files.uploadSecrets);
await deploy("content", files.contentConfig, files.contentSecrets);
await deploy("apex", files.apexConfig);

emitOutput("api_url", urls.api);
emitOutput("upload_url", urls.upload);
emitOutput("content_url", urls.content);
emitOutput("apex_url", urls.apex);
emitOutput("admin_token", prSecrets.ADMIN_TOKEN);

process.stdout.write(`PR preview deployed:
API:     ${urls.api}
Upload:  ${urls.upload}
Content: ${urls.content}
Apex:    ${urls.apex}
`);

async function deploy(app, configPath, secretsPath) {
  process.stdout.write(`Deploying ${names[app]}...\n`);
  await run("pnpm", ["exec", "wrangler", "deploy", "--config", configPath]);
  if (secretsPath) {
    await run("pnpm", ["exec", "wrangler", "secret", "bulk", secretsPath, "--name", names[app]]);
  }
}

function apiConfig() {
  return baseConfig("api", {
    main: workspacePath("apps/api/src/index.ts"),
    compatibility_flags: ["nodejs_compat"],
    triggers: { crons: ["*/15 * * * *"] },
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
    vars: {
      CONTENT_SIGNING_KID: "v1",
    },
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "agent-paste-artifacts-preview" }],
    kv_namespaces: [{ binding: "DENYLIST", id: "5780695433d4494897dcbb78bcb4f180" }],
    ratelimits: [rateLimit("ARTIFACT_RATE_LIMIT", `4${prNumber}003`, 60, 60)],
  });
}

function apexConfig() {
  return baseConfig("apex", {
    main: workspacePath("apps/apex/src/index.ts"),
    assets: {
      binding: "ASSETS",
      directory: workspacePath("apps/apex/public"),
      not_found_handling: "none",
      run_worker_first: true,
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
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
  const adminToken =
    process.env.AGENT_PASTE_PR_ADMIN_TOKEN ??
    process.env.AGENT_PASTE_PREVIEW_ADMIN_TOKEN ??
    `ap_admin_${prPreviewSecret("admin-token", 32)}`;
  const values = {
    CONTENT_SIGNING_SECRET: process.env.PREVIEW_CONTENT_SIGNING_SECRET ?? prPreviewSecret("content-signing"),
    UPLOAD_SIGNING_SECRET: process.env.PREVIEW_UPLOAD_SIGNING_SECRET ?? prPreviewSecret("upload-signing"),
    API_KEY_PEPPER_V1: apiKeyPepper,
    ADMIN_TOKEN: adminToken,
    ADMIN_TOKEN_HASH: process.env.PREVIEW_ADMIN_TOKEN_HASH ?? hmacBase64Url(adminToken, apiKeyPepper),
    OPERATOR_EMAILS: process.env.OPERATOR_EMAILS ?? "isaac@zaks.io",
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

function hmacBase64Url(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
