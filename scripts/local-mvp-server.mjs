#!/usr/bin/env node
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import apiWorker, { createMemoryEphemeralProvisionGateNamespace } from "../apps/api/dist/index.js";
import contentWorker from "../apps/content/dist/index.js";
import jobsWorker from "../apps/jobs/dist/index.js";
import streamWorker from "../apps/stream/dist/index.js";
import { createMemoryArtifactLiveNamespace } from "../apps/stream/dist/memory-artifact-live.js";
import uploadWorker from "../apps/upload/dist/index.js";
import { createLocalServices, createPostgresServices } from "../packages/db/dist/index.js";
import { encryptArtifactBytes } from "../packages/storage/dist/index.js";
import { createMemoryWriteAllowanceNamespace } from "../packages/write-allowance/dist/index.js";
import { loadEnvFiles } from "./lib/load-env-files.mjs";
import { LOCAL_SERVER_PORT_ENV, listenHttpPort } from "./lib/smoke-port.mjs";
import { loadWranglerEnvVars } from "./lib/wrangler-env-vars.mjs";
import { createJobsEnv } from "./local-jobs-bridge.mjs";
import { MemoryKVNamespace, MemoryR2Bucket } from "./memory-worker-bindings.mjs";
import { smokeHarnessSecretFromEnv } from "./smoke-harness.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

loadEnvFiles([".env", ".env.local", "apps/web/.dev.vars", "apps/api/.dev.vars"], { cwd: repoRoot });
loadWranglerEnvVars("apps/api/wrangler.jsonc", {
  cwd: repoRoot,
  envName: process.env.AGENT_PASTE_LOCAL_WORKOS_ENV ?? process.env.CLOUDFLARE_ENV ?? "production",
  keys: [
    "WORKOS_ISSUER",
    "WORKOS_CLI_AUDIENCE",
    "WORKOS_CLI_ISSUER",
    "WORKOS_CLI_JWKS_URL",
    "WORKOS_MCP_AUDIENCE",
    "WORKOS_MCP_ISSUER",
    "WORKOS_MCP_JWKS_URL",
  ],
});

const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const jobsPort = intEnv("AGENT_PASTE_LOCAL_JOBS_PORT", 8790);
const streamPort = intEnv("AGENT_PASTE_LOCAL_STREAM_PORT", 8791);
const smokeHarnessSecret = smokeHarnessSecretFromEnv();
const streamInternalSecret = process.env.STREAM_INTERNAL_SECRET ?? "local-stream-internal-secret";
const apiKeyPepper = process.env.AGENT_PASTE_API_KEY_PEPPER ?? "local-dev-pepper";
const uploadSecret = process.env.AGENT_PASTE_UPLOAD_SIGNING_SECRET ?? "local-upload-secret";
const contentSecret = process.env.AGENT_PASTE_CONTENT_SIGNING_SECRET ?? "local-content-secret";
const accessLinkSigningKey = process.env.AGENT_PASTE_ACCESS_LINK_SIGNING_KEY ?? "access-link-secret";
const artifactBytesEncryptionKey =
  process.env.AGENT_PASTE_ARTIFACT_BYTES_ENCRYPTION_KEY ?? "local-artifact-bytes-encryption-key";

const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const contentBaseUrl = `http://127.0.0.1:${contentPort}`;
const jobsBaseUrl = `http://127.0.0.1:${jobsPort}`;
const streamBaseUrl = `http://127.0.0.1:${streamPort}`;

const alwaysAllowRateLimit = {
  limit: async () => ({ success: true }),
};

function createWorkerServer(name, worker, env) {
  return createServer(async (incoming, outgoing) => {
    try {
      const request = nodeRequestToFetchRequest(incoming);
      const response = await worker.fetch(request, env);
      await writeFetchResponse(outgoing, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: { code: "local_harness_error", message: `${name}: ${message}` } }));
    }
  });
}

function nodeRequestToFetchRequest(incoming) {
  const host = incoming.headers.host ?? "127.0.0.1";
  const url = `http://${host}${incoming.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  // Cloudflare sets CF-Connecting-IP at the edge; the ephemeral provision rate-limit gate 503s without it.
  headers.set("cf-connecting-ip", headers.get("cf-connecting-ip") ?? incoming.socket?.remoteAddress ?? "127.0.0.1");

  const init = {
    method: incoming.method,
    headers,
  };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    init.body = incoming;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeFetchResponse(outgoing, response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  outgoing.writeHead(response.status, headers);
  if (!response.body) {
    outgoing.end();
    return;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    await pipeWebStreamToNode(outgoing, response.body);
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  outgoing.end(bytes);
}

function isOutgoingClosed(outgoing) {
  return outgoing.destroyed || outgoing.writableEnded;
}

async function pipeWebStreamToNode(outgoing, webStream) {
  const reader = webStream.getReader();
  const waitForDrain = () =>
    new Promise((resolve) => {
      if (isOutgoingClosed(outgoing)) {
        resolve();
        return;
      }
      const onDone = () => {
        outgoing.off("drain", onDone);
        outgoing.off("close", onDone);
        outgoing.off("error", onDone);
        resolve();
      };
      outgoing.on("drain", onDone);
      outgoing.on("close", onDone);
      outgoing.on("error", onDone);
    });

  try {
    while (true) {
      if (isOutgoingClosed(outgoing)) {
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      const canWrite = outgoing.write(Buffer.from(value));
      if (!canWrite) {
        await waitForDrain();
      }
    }
  } finally {
    reader.releaseLock();
    if (!isOutgoingClosed(outgoing)) {
      outgoing.end();
    }
  }
}

function listenNamedServer(server, name) {
  const port = serverPort(server, name);
  const envVar = LOCAL_SERVER_PORT_ENV[name];
  return listenHttpPort(server, port, { envVar, label: `${name} server` });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function serverPort(server, name) {
  if (name) {
    const ports = { api: apiPort, upload: uploadPort, content: contentPort, jobs: jobsPort, stream: streamPort };
    return ports[name];
  }
  if (server === servers?.[0]) return apiPort;
  if (server === servers?.[1]) return uploadPort;
  if (server === servers?.[2]) return contentPort;
  if (server === servers?.[3]) return jobsPort;
  return streamPort;
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function databaseBackendFromEnv() {
  const backend = process.env.AGENT_PASTE_LOCAL_DATABASE_BACKEND ?? "memory";
  if (backend === "memory" || backend === "postgres") {
    return backend;
  }
  throw new Error(`Unsupported AGENT_PASTE_LOCAL_DATABASE_BACKEND: ${backend}`);
}

function postgresBindingFromEnv() {
  const connectionString = process.env.AGENT_PASTE_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL_RUNTIME_CI;
  if (!connectionString) {
    throw new Error("Set AGENT_PASTE_LOCAL_DATABASE_URL when AGENT_PASTE_LOCAL_DATABASE_BACKEND=postgres.");
  }
  return { connectionString };
}

function createApiDatabase(repo) {
  return {
    getWhoami: repo.getWhoami.bind(repo),
    getUsagePolicy: repo.getUsagePolicy.bind(repo),
    getAgentView: repo.getAgentView?.bind(repo),
    getPublicAgentView: repo.getPublicAgentView.bind(repo),
    resolveAccessLink: repo.resolveAccessLink.bind(repo),
    createEphemeralWorkspace: repo.createEphemeralWorkspace.bind(repo),
    claimEphemeralWorkspace: repo.claimEphemeralWorkspace.bind(repo),
    getAdminWhoami: repo.getAdminWhoami?.bind(repo),
    createWorkspace: repo.createWorkspace.bind(repo),
    listWorkspaces: repo.listWorkspaces.bind(repo),
    createApiKey: repo.createApiKey.bind(repo),
    revokeApiKey: repo.revokeApiKey.bind(repo),
    async publishRevision(input) {
      const result = await repo.publishRevision(input);
      if (result?.bundle?.status === "pending") {
        await jobsEnv.BUNDLE_GENERATE_QUEUE.send({
          type: "bundle.generate.v1",
          workspace_id: input.actor.workspace_id,
          artifact_id: input.artifactId,
          revision_id: input.revisionId,
          requested_at: input.now,
          reason: "publish",
        });
      }
      return result;
    },
    listRevisions: repo.listRevisions.bind(repo),
    peekPublishWriteGate: repo.peekPublishWriteGate.bind(repo),
    peekWorkspaceCommandReplay: repo.peekWorkspaceCommandReplay.bind(repo),
    listArtifacts: repo.listArtifacts.bind(repo),
    getArtifactDetail: repo.getArtifactDetail.bind(repo),
    listOperationEvents: repo.listOperationEvents.bind(repo),
    forceExpireArtifact: repo.forceExpireArtifact.bind(repo),
    resolveWebMember: repo.resolveWebMember.bind(repo),
    ensureWebMember: repo.ensureWebMember.bind(repo),
    getWebMemberByWorkOsUserId: repo.getWebMemberByWorkOsUserId.bind(repo),
    getWebWorkspace: repo.getWebWorkspace.bind(repo),
    listWebArtifacts: repo.listWebArtifacts.bind(repo),
    getWebArtifact: repo.getWebArtifact.bind(repo),
    listWebApiKeys: repo.listWebApiKeys.bind(repo),
    createWebApiKey: repo.createWebApiKey.bind(repo),
    revokeWebApiKey: repo.revokeWebApiKey.bind(repo),
    revokeCurrentApiKey: repo.revokeCurrentApiKey.bind(repo),
    listWebAuditEvents: repo.listWebAuditEvents.bind(repo),
    getWebSettings: repo.getWebSettings.bind(repo),
    deleteArtifact: repo.deleteArtifact.bind(repo),
    createMemberAccessLink: repo.createMemberAccessLink.bind(repo),
    mintMemberAccessLink: repo.mintMemberAccessLink.bind(repo),
    listMemberAccessLinks: repo.listMemberAccessLinks.bind(repo),
    revokeMemberAccessLink: repo.revokeMemberAccessLink.bind(repo),
  };
}

const databaseBackend = databaseBackendFromEnv();
const postgresBinding = databaseBackend === "postgres" ? postgresBindingFromEnv() : null;
const services = postgresBinding
  ? createPostgresServices({
      binding: postgresBinding,
      apiKeyPepper,
      apiBaseUrl,
      contentBaseUrl,
    })
  : createLocalServices({
      apiKeyPepper,
      apiBaseUrl,
      contentBaseUrl,
    });
const artifacts = new MemoryR2Bucket();
const denylist = new MemoryKVNamespace();
const cliRelease = new MemoryKVNamespace();
const ephemeralProvisionConfig = new MemoryKVNamespace();
// Seed a non-zero `latest` (the published placeholder is 0.0.0) so a locally
// built CLI sees a newer version and the update-check nag is exercisable in dev.
await cliRelease.put("cli-release", JSON.stringify({ latest: "0.1.0", min_supported: "0.0.0" }));
const jobsEnv = createJobsEnv({
  repo: postgresBinding ? undefined : services.repo,
  db: postgresBinding ?? undefined,
  artifacts,
  denylist,
  smokeHarnessSecret,
  artifactBytesEncryptionKey,
});
const apiDb = postgresBinding ?? createApiDatabase(services.apiDb);

const auth = services.auth;
const apiEnv = {
  AUTH: auth,
  DB: apiDb,
  BUNDLE_GENERATE_QUEUE: jobsEnv.BUNDLE_GENERATE_QUEUE,
  SAFETY_SCAN_QUEUE: jobsEnv.SAFETY_SCAN_QUEUE,
  BYTE_PURGE_QUEUE: jobsEnv.BYTE_PURGE_QUEUE,
  ...(postgresBinding ? {} : { LOCAL_MVP_REPOSITORY: { revisions: services.repo.revisions } }),
  ARTIFACTS: artifacts,
  DENYLIST: denylist,
  CLI_RELEASE: cliRelease,
  EPHEMERAL_PROVISION_CONFIG: ephemeralProvisionConfig,
  ACTOR_RATE_LIMIT: alwaysAllowRateLimit,
  WORKSPACE_BURST_CAP: alwaysAllowRateLimit,
  ARTIFACT_RATE_LIMIT: alwaysAllowRateLimit,
  EPHEMERAL_POW_SECRET: process.env.EPHEMERAL_POW_SECRET ?? "local-ephemeral-pow-secret",
  EPHEMERAL_PROVISION_IP_RATE_LIMIT: alwaysAllowRateLimit,
  EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: alwaysAllowRateLimit,
  SMOKE_HARNESS_SECRET: smokeHarnessSecret,
  STREAM_INTERNAL_SECRET: streamInternalSecret,
  API_BASE_URL: apiBaseUrl,
  CONTENT_BASE_URL: contentBaseUrl,
  CONTENT_SIGNING_SECRET: contentSecret,
  API_KEY_PEPPER_V1: apiKeyPepper,
  ACCESS_LINK_SIGNING_KEY_V1: accessLinkSigningKey,
  CLEANUP_BATCH_SIZE: "100",
  AGENT_PASTE_ENV: "dev",
  WORKOS_API_KEY: process.env.WORKOS_API_KEY,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
  WORKOS_API_BASE_URL: process.env.WORKOS_API_BASE_URL,
  WORKOS_ISSUER: process.env.WORKOS_ISSUER,
  WORKOS_JWKS_URL: process.env.WORKOS_JWKS_URL,
  WORKOS_MCP_AUDIENCE: process.env.WORKOS_MCP_AUDIENCE ?? "https://mcp.agent-paste.sh/",
  WORKOS_MCP_ISSUER: process.env.WORKOS_MCP_ISSUER,
  WORKOS_MCP_JWKS_URL: process.env.WORKOS_MCP_JWKS_URL,
};
const artifactLive = createMemoryArtifactLiveNamespace({
  api: {
    fetch(request) {
      return apiWorker.fetch(request, apiEnv);
    },
  },
  streamInternalSecret,
});
apiEnv.ARTIFACT_LIVE = artifactLive;
apiEnv.WRITE_ALLOWANCE = createMemoryWriteAllowanceNamespace();
apiEnv.EPHEMERAL_PROVISION_GATE = createMemoryEphemeralProvisionGateNamespace(ephemeralProvisionConfig);
Object.defineProperty(apiEnv, "SYNC_BYTE_PURGE_DELETED_OBJECTS", {
  enumerable: true,
  get() {
    return jobsEnv.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0;
  },
  set(value) {
    jobsEnv.SYNC_BYTE_PURGE_DELETED_OBJECTS = value;
  },
});
const uploadEnv = {
  AUTH: auth,
  DB: postgresBinding ?? services.uploadDb,
  ARTIFACTS: artifacts,
  API_BASE_URL: apiBaseUrl,
  CONTENT_BASE_URL: contentBaseUrl,
  CONTENT_SIGNING_SECRET: contentSecret,
  API_KEY_PEPPER_V1: apiKeyPepper,
  UPLOAD_SIGNING_SECRET: uploadSecret,
  ARTIFACT_BYTES_ENCRYPTION_KEY: artifactBytesEncryptionKey,
  UPLOAD_BASE_URL: uploadBaseUrl,
  UPLOAD_URL_TTL_SECONDS: "900",
  ACTOR_RATE_LIMIT: alwaysAllowRateLimit,
  WORKSPACE_BURST_CAP: alwaysAllowRateLimit,
  WORKOS_API_KEY: process.env.WORKOS_API_KEY,
  WORKOS_API_BASE_URL: process.env.WORKOS_API_BASE_URL,
  WORKOS_MCP_AUDIENCE: process.env.WORKOS_MCP_AUDIENCE ?? "https://mcp.agent-paste.sh/",
  WORKOS_MCP_ISSUER: process.env.WORKOS_MCP_ISSUER,
  WORKOS_MCP_JWKS_URL: process.env.WORKOS_MCP_JWKS_URL,
  WORKOS_CLI_ISSUER: process.env.WORKOS_CLI_ISSUER,
  WORKOS_CLI_JWKS_URL: process.env.WORKOS_CLI_JWKS_URL,
};
const contentEnv = {
  ARTIFACTS: artifacts,
  DENYLIST: denylist,
  ARTIFACT_RATE_LIMIT: alwaysAllowRateLimit,
  CONTENT_SIGNING_SECRET: contentSecret,
  ARTIFACT_BYTES_ENCRYPTION_KEY: artifactBytesEncryptionKey,
};
const streamEnv = {
  API: {
    fetch(request) {
      return apiWorker.fetch(request, apiEnv);
    },
  },
  ARTIFACT_LIVE: artifactLive,
  STREAM_BASE_URL: streamBaseUrl,
  STREAM_INTERNAL_SECRET: streamInternalSecret,
  AGENT_PASTE_ENV: "dev",
};
if (!postgresBinding) {
  await seedProofArtifacts(services.repo, artifacts);
}

const serverDefs = [
  { name: "api", worker: apiWorker, env: apiEnv },
  { name: "upload", worker: uploadWorker, env: uploadEnv },
  { name: "content", worker: contentWorker, env: contentEnv },
  { name: "jobs", worker: jobsWorker, env: jobsEnv },
  { name: "stream", worker: streamWorker, env: streamEnv },
];

const servers = serverDefs.map(({ name, worker, env }) => createWorkerServer(name, worker, env));

try {
  await Promise.all(serverDefs.map(({ name }, index) => listenNamedServer(servers[index], name)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agent-paste local harness failed: ${message}\n`);
  process.exit(1);
}

process.stdout.write(`agent-paste local MVP running

  API:     ${apiBaseUrl}
  Upload:  ${uploadBaseUrl}
  Content: ${contentBaseUrl}
  Jobs:    ${jobsBaseUrl}
  Stream:  ${streamBaseUrl}
  DB:      ${databaseBackend}

  export AGENT_PASTE_API_URL=${apiBaseUrl}
  export AGENT_PASTE_UPLOAD_URL=${uploadBaseUrl}
  export AGENT_PASTE_JOBS_URL=${jobsBaseUrl}
  export AGENT_PASTE_STREAM_URL=${streamBaseUrl}

Sign in and publish:
  pnpm cli:dev login
  pnpm cli:dev whoami
  pnpm cli:dev publish examples/local-harness/site

`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    Promise.all(servers.map((server) => close(server))).finally(() => {
      process.exit(0);
    });
  });
}

async function seedProofArtifacts(repo, bucket) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Agent Paste Local Harness</title>
  </head>
  <body>
    <h1>Agent Paste Local Harness</h1>
    <p>This tiny site is used by CLI publish smoke tests.</p>
  </body>
</html>
`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const workspace = {
    id: "local-proof-workspace",
    name: "Local Proof",
    contact_email: "local-proof@example.test",
    auto_deletion_days: 30,
    created_at: now,
    updated_at: now,
  };
  repo.workspaces.set(workspace.id, workspace);

  for (const proof of [
    ["art_79V71GD8S2SDBC80XE5S81QTM9", "rev_NQPNYFXAMERX158ADY73GXVHJ8", "Local Proof"],
    ["art_F1VQQN4VZ2659D00VVDRPYXQV6", "rev_ZK9XBNG2M07V8PW7JQ7DCWWDD4", "Visible Proof"],
    ["art_TED4P4SDXPHS446P9YC37BB0YW", "rev_PZ96ZGCHHB4FQJN6YYMJAC45DZ", "Browser Proof"],
  ]) {
    const [artifactId, revisionId, title] = proof;
    const r2Key = `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`;
    repo.artifacts.set(artifactId, {
      id: artifactId,
      workspace_id: workspace.id,
      revision_id: revisionId,
      status: "active",
      title,
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: new TextEncoder().encode(html).byteLength,
      expires_at: expiresAt,
      created_by_type: "api_key",
      created_by_id: "local-proof-key",
      deleted_at: null,
      delete_reason: null,
      created_at: now,
      updated_at: now,
    });
    repo.artifactFiles.set(`${artifactId}:index.html`, {
      workspace_id: workspace.id,
      artifact_id: artifactId,
      revision_id: revisionId,
      path: "index.html",
      size_bytes: new TextEncoder().encode(html).byteLength,
      content_type: "text/html; charset=utf-8",
      r2_key: r2Key,
      uploaded_at: now,
    });
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode(html),
      rootSecret: artifactBytesEncryptionKey,
      kid: 1,
      context: {
        workspaceId: workspace.id,
        artifactId,
        revisionId,
        normalizedPath: "index.html",
      },
    });
    await bucket.put(r2Key, encrypted.ciphertext, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: encrypted.customMetadata,
    });
  }
}
