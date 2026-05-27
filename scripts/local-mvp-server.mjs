#!/usr/bin/env node
import { createServer } from "node:http";
import apiWorker from "../apps/api/dist/index.js";
import contentWorker from "../apps/content/dist/index.js";
import jobsWorker from "../apps/jobs/dist/index.js";
import streamWorker from "../apps/stream/dist/index.js";
import { createMemoryArtifactLiveNamespace } from "../apps/stream/dist/memory-artifact-live.js";
import uploadWorker from "../apps/upload/dist/index.js";
import { createLocalServices } from "../packages/db/dist/index.js";
import { createJobsEnv } from "./local-jobs-bridge.mjs";
import { smokeHarnessSecretFromEnv } from "./smoke-harness.mjs";

const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const jobsPort = intEnv("AGENT_PASTE_LOCAL_JOBS_PORT", 8790);
const streamPort = intEnv("AGENT_PASTE_LOCAL_STREAM_PORT", 8791);
const smokeHarnessSecret = smokeHarnessSecretFromEnv();
const apiKeyPepper = process.env.AGENT_PASTE_API_KEY_PEPPER ?? "local-dev-pepper";
const uploadSecret = process.env.AGENT_PASTE_UPLOAD_SIGNING_SECRET ?? "local-upload-secret";
const contentSecret = process.env.AGENT_PASTE_CONTENT_SIGNING_SECRET ?? "local-content-secret";
const accessLinkSigningKey = process.env.AGENT_PASTE_ACCESS_LINK_SIGNING_KEY ?? "access-link-secret";

const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const contentBaseUrl = `http://127.0.0.1:${contentPort}`;
const jobsBaseUrl = `http://127.0.0.1:${jobsPort}`;
const streamBaseUrl = `http://127.0.0.1:${streamPort}`;

function createWorkerServer(name, port, worker, env) {
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
  }).on("error", (error) => {
    process.stderr.write(`agent-paste local ${name} server failed on port ${port}: ${error.message}\n`);
    process.exitCode = 1;
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

function listen(server) {
  return new Promise((resolve) => server.listen(serverPort(server), "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function serverPort(server) {
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

class MemoryKVNamespace {
  #values = new Map();

  async get(key) {
    return this.#values.get(key) ?? null;
  }

  async put(key, value) {
    this.#values.set(key, value);
  }
}

class MemoryR2Bucket {
  #objects = new Map();

  async put(key, value, options = {}) {
    const bytes = await bytesFromBody(value);
    this.#objects.set(key, {
      bytes,
      httpMetadata: {
        contentType: options.httpMetadata?.contentType,
      },
    });
    return {};
  }

  async head(key) {
    const object = this.#objects.get(key);
    if (!object) {
      return null;
    }
    return this.#objectBody(object);
  }

  async get(key) {
    const object = this.#objects.get(key);
    if (!object) {
      return null;
    }
    return this.#objectBody(object);
  }

  async list(options = {}) {
    const prefix = options.prefix ?? "";
    const keys = [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }

  async delete(keys) {
    const targets = Array.isArray(keys) ? keys : [keys];
    for (const key of targets) {
      this.#objects.delete(key);
    }
  }

  #objectBody(object) {
    return {
      body: new Blob([object.bytes]).stream(),
      size: object.bytes.byteLength,
      httpMetadata: object.httpMetadata,
      writeHttpMetadata(headers) {
        if (object.httpMetadata.contentType) {
          headers.set("content-type", object.httpMetadata.contentType);
        }
      },
    };
  }
}

async function bytesFromBody(value) {
  if (value === null || value === undefined) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  if (typeof value.arrayBuffer === "function") {
    return new Uint8Array(await value.arrayBuffer());
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function createApiDatabase(repo, denylistNamespace) {
  return {
    getWhoami: repo.getWhoami.bind(repo),
    getAgentView: repo.getAgentView?.bind(repo),
    getPublicAgentView: repo.getPublicAgentView.bind(repo),
    resolveAccessLink: repo.resolveAccessLink.bind(repo),
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
    listArtifacts: repo.listArtifacts.bind(repo),
    getArtifactDetail: repo.getArtifactDetail.bind(repo),
    listOperationEvents: repo.listOperationEvents.bind(repo),
    forceExpireArtifact: repo.forceExpireArtifact.bind(repo),
    resolveWebMember: repo.resolveWebMember.bind(repo),
    getWebMemberByWorkOsUserId: repo.getWebMemberByWorkOsUserId.bind(repo),
    getWebWorkspace: repo.getWebWorkspace.bind(repo),
    listWebArtifacts: repo.listWebArtifacts.bind(repo),
    getWebArtifact: repo.getWebArtifact.bind(repo),
    listWebApiKeys: repo.listWebApiKeys.bind(repo),
    listWebAuditEvents: repo.listWebAuditEvents.bind(repo),
    getWebSettings: repo.getWebSettings.bind(repo),
    async deleteArtifact(input) {
      const result = await repo.deleteArtifact(input);
      await denylistNamespace.put(`ad:${input.artifactId}`, JSON.stringify({ reason: "deletion" }));
      return result;
    },
  };
}

const services = createLocalServices({
  apiKeyPepper,
  apiBaseUrl,
  contentBaseUrl,
});
const artifacts = new MemoryR2Bucket();
const denylist = new MemoryKVNamespace();
const jobsEnv = createJobsEnv({
  repo: services.repo,
  artifacts,
  denylist,
  smokeHarnessSecret,
});
const apiDb = createApiDatabase(services.apiDb, denylist);
const artifactLive = createMemoryArtifactLiveNamespace();

const auth = services.auth;
const apiEnv = {
  AUTH: auth,
  DB: apiDb,
  ARTIFACT_LIVE: artifactLive,
  BUNDLE_GENERATE_QUEUE: jobsEnv.BUNDLE_GENERATE_QUEUE,
  ARTIFACTS: artifacts,
  DENYLIST: denylist,
  SMOKE_HARNESS_SECRET: smokeHarnessSecret,
  API_BASE_URL: apiBaseUrl,
  CONTENT_BASE_URL: contentBaseUrl,
  CONTENT_SIGNING_SECRET: contentSecret,
  ACCESS_LINK_SIGNING_KEY_V1: accessLinkSigningKey,
  CLEANUP_BATCH_SIZE: "100",
  AGENT_PASTE_ENV: "dev",
  WORKOS_API_KEY: process.env.WORKOS_API_KEY,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
  WORKOS_API_BASE_URL: process.env.WORKOS_API_BASE_URL,
  WORKOS_ISSUER: process.env.WORKOS_ISSUER,
  WORKOS_JWKS_URL: process.env.WORKOS_JWKS_URL,
};
const uploadEnv = {
  AUTH: auth,
  DB: services.uploadDb,
  ARTIFACTS: artifacts,
  API_BASE_URL: apiBaseUrl,
  CONTENT_BASE_URL: contentBaseUrl,
  CONTENT_SIGNING_SECRET: contentSecret,
  UPLOAD_SIGNING_SECRET: uploadSecret,
  UPLOAD_BASE_URL: uploadBaseUrl,
  UPLOAD_URL_TTL_SECONDS: "900",
};
const contentEnv = {
  ARTIFACTS: artifacts,
  DENYLIST: denylist,
  CONTENT_SIGNING_SECRET: contentSecret,
};
const streamEnv = {
  API: {
    fetch(request) {
      return apiWorker.fetch(request, apiEnv);
    },
  },
  ARTIFACT_LIVE: artifactLive,
  STREAM_BASE_URL: streamBaseUrl,
  AGENT_PASTE_ENV: "dev",
};
await seedProofArtifacts(services.repo, artifacts);

const servers = [
  createWorkerServer("api", apiPort, apiWorker, apiEnv),
  createWorkerServer("upload", uploadPort, uploadWorker, uploadEnv),
  createWorkerServer("content", contentPort, contentWorker, contentEnv),
  createWorkerServer("jobs", jobsPort, jobsWorker, jobsEnv),
  createWorkerServer("stream", streamPort, streamWorker, streamEnv),
];

await Promise.all(servers.map((server) => listen(server)));

process.stdout.write(`agent-paste local MVP running

  API:     ${apiBaseUrl}
  Upload:  ${uploadBaseUrl}
  Content: ${contentBaseUrl}
  Jobs:    ${jobsBaseUrl}
  Stream:  ${streamBaseUrl}

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
      created_by_api_key_id: "local-proof-key",
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
    await bucket.put(r2Key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  }
}
