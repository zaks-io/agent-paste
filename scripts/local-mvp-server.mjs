#!/usr/bin/env node
import { createServer } from "node:http";
import apiWorker from "../apps/api/dist/index.js";
import contentWorker from "../apps/content/dist/index.js";
import uploadWorker from "../apps/upload/dist/index.js";
import { createLocalServices } from "../packages/db/dist/index.js";

const apiPort = intEnv("AGENT_PASTE_LOCAL_API_PORT", 8787);
const uploadPort = intEnv("AGENT_PASTE_LOCAL_UPLOAD_PORT", 8788);
const contentPort = intEnv("AGENT_PASTE_LOCAL_CONTENT_PORT", 8789);
const adminToken = process.env.AGENT_PASTE_ADMIN_TOKEN ?? "local-admin-token";
const apiKeyPepper = process.env.AGENT_PASTE_API_KEY_PEPPER ?? "local-dev-pepper";
const uploadSecret = process.env.AGENT_PASTE_UPLOAD_SIGNING_SECRET ?? "local-upload-secret";
const contentSecret = process.env.AGENT_PASTE_CONTENT_SIGNING_SECRET ?? "local-content-secret";

const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;
const contentBaseUrl = `http://127.0.0.1:${contentPort}`;

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
  if (response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    outgoing.end(bytes);
  } else {
    outgoing.end();
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(serverPort(server), "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function serverPort(server) {
  return server === servers?.[0] ? apiPort : server === servers?.[1] ? uploadPort : contentPort;
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
    getAdminWhoami: repo.getAdminWhoami?.bind(repo),
    createWorkspace: repo.createWorkspace.bind(repo),
    listWorkspaces: repo.listWorkspaces.bind(repo),
    createApiKey: repo.createApiKey.bind(repo),
    revokeApiKey: repo.revokeApiKey.bind(repo),
    listArtifacts: repo.listArtifacts.bind(repo),
    getArtifactDetail: repo.getArtifactDetail.bind(repo),
    listOperationEvents: repo.listOperationEvents.bind(repo),
    async deleteArtifact(artifactId) {
      const result = await repo.deleteArtifact(artifactId);
      await denylistNamespace.put(`artifact:${artifactId}`, JSON.stringify({ reason: "admin_delete" }));
      return result;
    },
    async runCleanup(input) {
      const result = await repo.runCleanup(input);
      if (!input.dryRun) {
        for (const artifact of repo.artifacts.values()) {
          if (artifact.status !== "active") {
            await denylistNamespace.put(`artifact:${artifact.id}`, JSON.stringify({ reason: artifact.status }));
          }
        }
      }
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
const apiDb = createApiDatabase(services.apiDb, denylist);

const auth = services.auth;
const apiEnv = {
  AUTH: auth,
  DB: apiDb,
  ADMIN_TOKEN: adminToken,
  API_BASE_URL: apiBaseUrl,
  CONTENT_BASE_URL: contentBaseUrl,
  CONTENT_SIGNING_SECRET: contentSecret,
  CLEANUP_BATCH_SIZE: "100",
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
  ALLOW_DEV_TOKENS: "true",
};

await seedProofArtifacts(services.repo, artifacts);

const servers = [
  createWorkerServer("api", apiPort, apiWorker, apiEnv),
  createWorkerServer("upload", uploadPort, uploadWorker, uploadEnv),
  createWorkerServer("content", contentPort, contentWorker, contentEnv),
];

await Promise.all(servers.map((server) => listen(server)));

process.stdout.write(`agent-paste local MVP running

  API:     ${apiBaseUrl}
  Upload:  ${uploadBaseUrl}
  Content: ${contentBaseUrl}

  export AGENT_PASTE_ADMIN_TOKEN=${adminToken}
  export AGENT_PASTE_ADMIN_URL=${apiBaseUrl}
  export AGENT_PASTE_API_URL=${apiBaseUrl}
  export AGENT_PASTE_UPLOAD_URL=${uploadBaseUrl}

Create a workspace/key:
  pnpm cli:dev admin workspace create local@example.com --name Local
  pnpm cli:dev admin key create <workspace-id> --name local

Then:
  export AGENT_PASTE_API_KEY=<secret-from-key-create>
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
