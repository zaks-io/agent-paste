import { describe, expect, it } from "vitest";
import contentWorker from "../../content/src/index.js";
import uploadWorker from "../../upload/src/index.js";
import apiWorker from "./index.js";

class MemoryR2 {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: Record<string, string> },
  ) {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value
            ? new Uint8Array(await new Response(value).arrayBuffer())
            : new Uint8Array();
    const record: { bytes: Uint8Array; contentType?: string } = { bytes };
    if (options?.httpMetadata?.contentType) {
      record.contentType = options.httpMetadata.contentType;
    }
    this.objects.set(key, record);
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { body: null, size: object.bytes.byteLength } : null;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    const httpMetadata: { contentType?: string } = {};
    if (object.contentType) {
      httpMetadata.contentType = object.contentType;
    }
    return {
      body: new Response(new TextDecoder().decode(object.bytes)).body,
      size: object.bytes.byteLength,
      httpMetadata,
    };
  }
}

class MemoryKv {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
}

class MemoryDb {
  workspace = { id: "00000000-0000-4000-8000-000000000001", name: "User", created_at: "2026-01-01T00:00:00.000Z" };
  session:
    | {
        upload_session_id: string;
        artifact_id: string;
        revision_id: string;
        title: string;
        entrypoint: string;
        expires_at: string;
        files: Array<{ path: string; size_bytes: number; object_key: string; expires_at: string }>;
      }
    | undefined;

  async getWhoami() {
    return {
      actor: { type: "api_key", id: "key_00000000000000000000000000", name: "default" },
      workspace: this.workspace,
      scopes: ["publish", "read"],
      usage_policy: {
        file_size_cap_bytes: 10 * 1024 * 1024,
        artifact_size_cap_bytes: 25 * 1024 * 1024,
        file_count_cap: 100,
        actor_rate_limit_per_minute: 60,
        workspace_burst_cap_per_minute: 300,
        upload_session_ttl_seconds: 86_400,
        default_ttl_seconds: 2_592_000,
        min_ttl_seconds: 86_400,
        max_ttl_seconds: 7_776_000,
      },
    };
  }

  async createWorkspace() {
    return { ...this.workspace, contact_email: "user@example.com" };
  }

  async createApiKey() {
    return {
      api_key: {
        id: "key_00000000000000000000000000",
        workspace_id: this.workspace.id,
        name: "default",
        public_id: "0000000000000000",
        scopes: ["publish", "read"],
        revoked_at: null,
        created_at: this.workspace.created_at,
        last_used_at: null,
      },
      secret: "api-key",
    };
  }

  async createUploadSession(input: {
    request: { title?: string; entrypoint?: string; files: Array<{ path: string; size_bytes: number }> };
  }) {
    this.session = {
      upload_session_id: "upl_00000000000000000000000000",
      artifact_id: "art_00000000000000000000000000",
      revision_id: "rev_00000000000000000000000000",
      title: input.request.title ?? "demo",
      entrypoint: input.request.entrypoint ?? "index.html",
      expires_at: "2030-01-02T00:00:00.000Z",
      files: input.request.files.map((file) => ({
        ...file,
        object_key: `artifacts/art_00000000000000000000000000/revisions/rev_00000000000000000000000000/files/${file.path}`,
        expires_at: "2030-01-02T00:00:00.000Z",
      })),
    };
    return { ...this.session, session_id: this.session.upload_session_id };
  }

  async recordUploadedFile() {}

  async peekIdempotentReplay() {
    return null;
  }

  async getUploadSession() {
    return this.session ? { ...this.session, session_id: this.session.upload_session_id } : null;
  }

  async finalizeUploadSession() {
    const session = this.mustSession();
    return {
      upload_session_id: session.upload_session_id,
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      status: "draft",
      title: session.title,
      entrypoint: session.entrypoint,
      file_count: session.files.length,
      size_bytes: session.files.reduce((sum, file) => sum + file.size_bytes, 0),
    };
  }

  async publishRevision() {
    const session = this.mustSession();
    return {
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      title: session.title,
      view_url: `http://content.local/v/${session.artifact_id}.${session.revision_id}/${session.entrypoint}`,
      agent_view_url: `http://api.local/v1/public/agent-view/${session.artifact_id}.${session.revision_id}`,
      expires_at: "2030-01-02T00:00:00.000Z",
    };
  }

  async listRevisions() {
    return {
      artifact_id: this.mustSession().artifact_id,
      items: [],
      page_info: { next_cursor: null, has_more: false },
    };
  }

  async getPublicAgentView() {
    const session = this.mustSession();
    return {
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      title: session.title,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2030-01-02T00:00:00.000Z",
      entrypoint: session.entrypoint,
      view_url: `http://content.local/v/${session.artifact_id}.${session.revision_id}/${session.entrypoint}`,
      files: session.files.map((file) => ({
        path: file.path,
        size_bytes: file.size_bytes,
        content_type: "text/html; charset=utf-8",
        url: `http://content.local/v/${session.artifact_id}.${session.revision_id}/${file.path}`,
      })),
    };
  }

  async getAgentView() {
    return this.getPublicAgentView();
  }

  async runCleanup() {
    return {
      dry_run: false,
      expired_artifacts: 0,
      expired_upload_sessions: 0,
      deleted_r2_objects: 0,
      occurred_at: "2026-01-01T00:00:00.000Z",
    };
  }

  private mustSession() {
    if (!this.session) {
      throw new Error("session missing");
    }
    return this.session;
  }
}

describe("local MVP vertical slice", () => {
  it("publishes and serves a single HTML artifact", async () => {
    const db = new MemoryDb();
    const auth = {
      verifyApiKey: async (apiKey: string) =>
        apiKey === "api-key"
          ? {
              type: "api_key" as const,
              id: "key_00000000000000000000000000",
              workspace_id: db.workspace.id,
              scopes: ["publish" as const, "read" as const],
            }
          : null,
    };
    const artifacts = new MemoryR2();
    const adminHeaders = {
      authorization: "Bearer admin",
      "content-type": "application/json",
      "idempotency-key": "admin-1",
    };

    const workspaceResponse = await apiWorker.fetch(
      new Request("http://api.local/admin/workspaces", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ email: "user@example.com", name: "User" }),
      }),
      { AUTH: auth, DB: db, ADMIN_TOKEN: "admin", CONTENT_BASE_URL: "http://content.local" },
    );
    expect(workspaceResponse.status).toBe(201);
    const workspace = (await workspaceResponse.json()) as { id: string };

    const keyResponse = await apiWorker.fetch(
      new Request(`http://api.local/admin/workspaces/${workspace.id}/api-keys`, {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": "admin-2" },
        body: JSON.stringify({ name: "default" }),
      }),
      { AUTH: auth, DB: db, ADMIN_TOKEN: "admin", CONTENT_BASE_URL: "http://content.local" },
    );
    expect(keyResponse.status).toBe(201);
    const key = (await keyResponse.json()) as { secret: string };
    const apiHeaders = {
      authorization: `Bearer ${key.secret}`,
      "content-type": "application/json",
      "idempotency-key": "publish-1",
    };

    const sessionResponse = await uploadWorker.fetch(
      new Request("http://upload.local/v1/upload-sessions", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          title: "demo",
          ttl_seconds: 86_400,
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 12 }],
        }),
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as { upload_session_id: string; files: Array<{ put_url: string }> };
    const uploadTarget = session.files[0];
    if (!uploadTarget) {
      throw new Error("missing upload target");
    }

    const putResponse = await uploadWorker.fetch(
      new Request(uploadTarget.put_url, {
        method: "PUT",
        headers: { "content-length": "12", "content-type": "text/html; charset=utf-8" },
        body: "hello world!",
      }),
      { AUTH: auth, DB: db, ARTIFACTS: artifacts, UPLOAD_SIGNING_SECRET: "upload-secret" },
    );
    expect(putResponse.status).toBe(204);

    const finalizeResponse = await uploadWorker.fetch(
      new Request(`http://upload.local/v1/upload-sessions/${session.upload_session_id}/finalize`, {
        method: "POST",
        headers: apiHeaders,
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(finalizeResponse.status).toBe(200);
    const finalized = (await finalizeResponse.json()) as {
      artifact_id: string;
      revision_id: string;
      status: string;
    };
    expect(finalized.status).toBe("draft");

    const publishResponse = await apiWorker.fetch(
      new Request(`http://api.local/v1/artifacts/${finalized.artifact_id}/revisions/${finalized.revision_id}/publish`, {
        method: "POST",
        headers: apiHeaders,
      }),
      {
        AUTH: auth,
        DB: db,
        ADMIN_TOKEN: "admin",
        CONTENT_BASE_URL: "http://content.local",
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
      },
    );
    expect(publishResponse.status).toBe(200);
    const published = (await publishResponse.json()) as { view_url: string; agent_view_url: string };
    const agentViewResponse = await apiWorker.fetch(new Request(published.agent_view_url), {
      AUTH: auth,
      DB: db,
      ADMIN_TOKEN: "admin",
      CONTENT_BASE_URL: "http://content.local",
      CONTENT_SIGNING_SECRET: "content-secret",
    });
    expect(agentViewResponse.status).toBe(200);
    await expect(agentViewResponse.json()).resolves.toMatchObject({ title: "demo", files: [{ path: "index.html" }] });

    const contentResponse = await contentWorker.fetch(new Request(published.view_url), {
      ARTIFACTS: artifacts,
      DENYLIST: new MemoryKv(),
      CONTENT_SIGNING_SECRET: "content-secret",
    });
    expect(contentResponse.status).toBe(200);
    await expect(contentResponse.text()).resolves.toBe("hello world!");
  });
});
