import { mintContentUrl } from "@agent-paste/tokens/content";
import { describe, expect, it } from "vitest";
import contentWorker from "../../content/src/index.js";
import uploadWorker from "../../upload/src/index.js";
import apiWorker from "./index.js";

const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

const allowRateLimit = {
  async limit() {
    return { success: true };
  },
};

const rateLimitEnv = {
  ACTOR_RATE_LIMIT: allowRateLimit,
  WORKSPACE_BURST_CAP: allowRateLimit,
  ARTIFACT_RATE_LIMIT: allowRateLimit,
};

class MemoryR2 {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> }
  >();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string | null,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ) {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : value
              ? new Uint8Array(await new Response(value).arrayBuffer())
              : new Uint8Array();
    const record: { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> } = { bytes };
    if (options?.httpMetadata?.contentType) {
      record.contentType = options.httpMetadata.contentType;
    }
    if (options?.customMetadata) {
      record.customMetadata = options.customMetadata;
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
      body: new Blob([object.bytes]).stream(),
      size: object.bytes.byteLength,
      httpMetadata,
      customMetadata: object.customMetadata,
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
  revisions: Array<{
    revision_id: string;
    revision_number: number;
    status: "draft" | "published";
    entrypoint: string;
    file_count: number;
    size_bytes: number;
  }> = [];
  session:
    | {
        upload_session_id: string;
        workspace_id: string;
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
        live_artifacts_cap: 50,
        live_update_enabled: false,
        daily_new_artifact_allowance: 100,
        lifetime_revision_ceiling: 100,
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
        expires_at: null,
        created_at: this.workspace.created_at,
        last_used_at: null,
      },
      secret: "api-key",
    };
  }

  async createUploadSession(input: {
    request: {
      artifact_id?: string;
      title?: string;
      entrypoint?: string;
      files: Array<{ path: string; size_bytes: number }>;
    };
  }) {
    const artifactId = input.request.artifact_id ?? "art_00000000000000000000000000";
    const revisionId = input.request.artifact_id ? "rev_00000000000000000000000001" : "rev_00000000000000000000000000";
    this.session = {
      upload_session_id: input.request.artifact_id
        ? "upl_00000000000000000000000001"
        : "upl_00000000000000000000000000",
      workspace_id: this.workspace.id,
      artifact_id: artifactId,
      revision_id: revisionId,
      title: input.request.title ?? "demo",
      entrypoint: input.request.entrypoint ?? "index.html",
      expires_at: "2030-01-02T00:00:00.000Z",
      files: input.request.files.map((file) => ({
        ...file,
        object_key: `artifacts/${artifactId}/revisions/${revisionId}/files/${file.path}`,
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

  async getUploadSessionState() {
    return this.session ? { status: "pending", expiresAt: this.session.expires_at } : null;
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
    const revisionNumber = this.revisions.filter((row) => row.status === "published").length + 1;
    this.revisions.push({
      revision_id: session.revision_id,
      revision_number: revisionNumber,
      status: "published",
      entrypoint: session.entrypoint,
      file_count: session.files.length,
      size_bytes: session.files.reduce((sum, file) => sum + file.size_bytes, 0),
    });
    const revisionContentUrl = await mintContentUrl({
      baseUrl: "http://content.local",
      secret: "content-secret",
      payload: {
        workspace_id: session.workspace_id,
        artifact_id: session.artifact_id,
        revision_id: session.revision_id,
        paths: session.files.map((file) => file.path),
        exp: Math.floor(Date.parse("2030-01-02T00:00:00.000Z") / 1000),
      },
      path: session.entrypoint,
    });
    return {
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      title: session.title,
      revision_content_url: revisionContentUrl,
      agent_view_url: `http://api.local/v1/public/agent-view/${session.artifact_id}.${session.revision_id}`,
      expires_at: "2030-01-02T00:00:00.000Z",
    };
  }

  async listRevisions() {
    const session = this.mustSession();
    return {
      artifact_id: session.artifact_id,
      items: this.revisions.map((row) => ({
        revision_id: row.revision_id,
        revision_number: row.revision_number,
        status: row.status,
        entrypoint: row.entrypoint,
        render_mode: "html",
        file_count: row.file_count,
        size_bytes: row.size_bytes,
        created_at: "2026-01-01T00:00:00.000Z",
        published_at: row.status === "published" ? "2026-01-01T00:00:00.000Z" : null,
      })),
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
      revision_content_url: `http://content.local/v/${session.artifact_id}.${session.revision_id}/${session.entrypoint}`,
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
    const apiHeaders = {
      authorization: "Bearer api-key",
      "content-type": "application/json",
      "idempotency-key": "publish-1",
    };

    const sessionResponse = await uploadWorker.fetch(
      new Request("http://upload.local/v1/upload-sessions", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          title: "demo",
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 12 }],
        }),
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as {
      upload_session_id: string;
      files: Array<{ status: string; put_url?: string }>;
    };
    const uploadTarget = session.files[0];
    if (!uploadTarget || uploadTarget.status !== "upload_required" || !uploadTarget.put_url) {
      throw new Error("missing upload target");
    }

    const putResponse = await uploadWorker.fetch(
      new Request(uploadTarget.put_url, {
        method: "PUT",
        headers: { "content-length": "12", "content-type": "text/html; charset=utf-8" },
        body: "hello world!",
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
      },
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
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
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
        ...rateLimitEnv,
        CONTENT_BASE_URL: "http://content.local",
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
      },
    );
    expect(publishResponse.status).toBe(200);
    const published = (await publishResponse.json()) as { revision_content_url: string; agent_view_url: string };
    const agentViewResponse = await apiWorker.fetch(new Request(published.agent_view_url), {
      AUTH: auth,
      DB: db,
      ...rateLimitEnv,
      CONTENT_BASE_URL: "http://content.local",
      CONTENT_SIGNING_SECRET: "content-secret",
    });
    expect(agentViewResponse.status).toBe(200);
    await expect(agentViewResponse.json()).resolves.toMatchObject({ title: "demo", files: [{ path: "index.html" }] });

    const contentResponse = await contentWorker.fetch(new Request(published.revision_content_url), {
      ARTIFACTS: artifacts,
      DENYLIST: new MemoryKv(),
      ...rateLimitEnv,
      CONTENT_SIGNING_SECRET: "content-secret",
      ...artifactBytesEncryptionEnv,
    });
    expect(contentResponse.status).toBe(200);
    await expect(contentResponse.text()).resolves.toBe("hello world!");

    const revisionsResponse = await apiWorker.fetch(
      new Request(`http://api.local/v1/artifacts/${finalized.artifact_id}/revisions`, {
        headers: { authorization: "Bearer api-key" },
      }),
      {
        AUTH: auth,
        DB: db,
        ...rateLimitEnv,
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(revisionsResponse.status).toBe(200);
    await expect(revisionsResponse.json()).resolves.toMatchObject({
      artifact_id: finalized.artifact_id,
      items: [{ revision_id: finalized.revision_id, revision_number: 1, status: "published" }],
    });

    const updateSessionResponse = await uploadWorker.fetch(
      new Request("http://upload.local/v1/upload-sessions", {
        method: "POST",
        headers: { ...apiHeaders, "idempotency-key": "publish-2" },
        body: JSON.stringify({
          artifact_id: finalized.artifact_id,
          title: "demo v2",
          ttl_seconds: 86_400,
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 13 }],
        }),
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(updateSessionResponse.status).toBe(200);
    const updateSession = (await updateSessionResponse.json()) as {
      upload_session_id: string;
      artifact_id: string;
      files: Array<{ status: string; put_url?: string }>;
    };
    expect(updateSession.artifact_id).toBe(finalized.artifact_id);

    const updatePutUrl = updateSession.files[0]?.put_url;
    if (updateSession.files[0]?.status !== "upload_required" || !updatePutUrl) {
      throw new Error("missing update upload target");
    }
    await uploadWorker.fetch(
      new Request(updatePutUrl, {
        method: "PUT",
        headers: { "content-length": "13", "content-type": "text/html; charset=utf-8" },
        body: "hello world!!",
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
      },
    );

    const updateFinalizeResponse = await uploadWorker.fetch(
      new Request(`http://upload.local/v1/upload-sessions/${updateSession.upload_session_id}/finalize`, {
        method: "POST",
        headers: { ...apiHeaders, "idempotency-key": "publish-2" },
      }),
      {
        AUTH: auth,
        DB: db,
        ARTIFACTS: artifacts,
        ...rateLimitEnv,
        UPLOAD_SIGNING_SECRET: "upload-secret",
        ...artifactBytesEncryptionEnv,
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
        CONTENT_BASE_URL: "http://content.local",
      },
    );
    expect(updateFinalizeResponse.status).toBe(200);
    const updateFinalized = (await updateFinalizeResponse.json()) as { revision_id: string; status: string };
    expect(updateFinalized.status).toBe("draft");

    const updatePublishResponse = await apiWorker.fetch(
      new Request(
        `http://api.local/v1/artifacts/${finalized.artifact_id}/revisions/${updateFinalized.revision_id}/publish`,
        {
          method: "POST",
          headers: { ...apiHeaders, "idempotency-key": "publish-2" },
        },
      ),
      {
        AUTH: auth,
        DB: db,
        ...rateLimitEnv,
        CONTENT_BASE_URL: "http://content.local",
        CONTENT_SIGNING_SECRET: "content-secret",
        API_BASE_URL: "http://api.local",
      },
    );
    expect(updatePublishResponse.status).toBe(200);

    const updatedRevisionsResponse = await apiWorker.fetch(
      new Request(`http://api.local/v1/artifacts/${finalized.artifact_id}/revisions`, {
        headers: { authorization: "Bearer api-key" },
      }),
      { AUTH: auth, DB: db, ...rateLimitEnv, CONTENT_BASE_URL: "http://content.local" },
    );
    expect(updatedRevisionsResponse.status).toBe(200);
    await expect(updatedRevisionsResponse.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ revision_number: 1, status: "published" }),
        expect.objectContaining({ revision_id: updateFinalized.revision_id, revision_number: 2, status: "published" }),
      ]),
    });
  });
});
