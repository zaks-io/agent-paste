import {
  type ApiKeyId,
  ApiKeyListResponse,
  ArtifactDetail,
  type ArtifactId,
  ArtifactListResponse,
  type CleanupRunRequest,
  CleanupRunResponse,
  type CreateApiKeyRequest,
  CreateApiKeyResponse,
  type CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  type CreateWorkspaceRequest,
  DeleteArtifactResponse,
  ErrorEnvelope,
  FinalizeUploadSessionResponse,
  type IdempotencyKey,
  OperationEventListResponse,
  type PaginationRequest,
  PublishResult,
  type RevisionId,
  RevisionListResponse,
  RevokeApiKeyResponse,
  type UploadSessionId,
  UsagePolicy,
  WhoamiResponse,
  WorkspaceDetail,
  type WorkspaceId,
  WorkspaceListResponse,
} from "@agent-paste/contracts";

type Schema<Output> = {
  parse: (value: unknown) => Output;
};

export type AgentPasteAuth =
  | { type: "api_key"; apiKey: string }
  | { type: "bearer"; getAccessToken: () => string | Promise<string> };

export type ApiClientOptions = {
  auth?: AgentPasteAuth;
  apiBaseUrl?: string;
  uploadBaseUrl?: string;
  adminBaseUrl?: string;
  adminToken?: string;
  fetch?: typeof fetch;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  auth?: "api_key" | "admin_token" | "bearer" | "none";
  headers?: Record<string, string>;
};

export class AgentPasteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly docs: string | undefined;

  constructor(input: { code: string; message: string; status: number; requestId?: string; docs?: string }) {
    super(input.message);
    this.name = "AgentPasteError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.docs = input.docs;
  }
}

export class ApiClient {
  readonly apiBaseUrl: string;
  readonly uploadBaseUrl: string;
  readonly adminBaseUrl: string;

  private readonly auth: AgentPasteAuth | undefined;
  private readonly adminToken: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.auth = options.auth ?? authFromEnv();
    this.adminToken = options.adminToken ?? process.env.AGENT_PASTE_ADMIN_TOKEN;
    this.apiBaseUrl = normalizeBaseUrl(
      options.apiBaseUrl ?? process.env.AGENT_PASTE_API_URL ?? "https://api.agent-paste.sh",
    );
    this.uploadBaseUrl = normalizeBaseUrl(
      options.uploadBaseUrl ?? process.env.AGENT_PASTE_UPLOAD_URL ?? "https://upload.agent-paste.sh",
    );
    this.adminBaseUrl = normalizeBaseUrl(options.adminBaseUrl ?? process.env.AGENT_PASTE_ADMIN_URL ?? this.apiBaseUrl);
    this.fetchImpl = options.fetch ?? fetch;
  }

  whoami() {
    return this.request(WhoamiResponse, this.apiBaseUrl, "/v1/whoami");
  }

  usagePolicy() {
    return this.request(UsagePolicy, this.apiBaseUrl, "/v1/usage-policy");
  }

  uploadSessions = {
    create: (body: CreateUploadSessionRequest, idempotencyKey: string) =>
      this.request(CreateUploadSessionResponse, this.uploadBaseUrl, "/v1/upload-sessions", {
        method: "POST",
        body,
        idempotencyKey,
      }),
    finalize: (uploadSessionId: UploadSessionId | string, idempotencyKey: string) =>
      this.request(
        FinalizeUploadSessionResponse,
        this.uploadBaseUrl,
        `/v1/upload-sessions/${encodeURIComponent(uploadSessionId)}/finalize`,
        {
          method: "POST",
          idempotencyKey,
        },
      ),
  };

  revisions = {
    publish: (artifactId: ArtifactId | string, revisionId: RevisionId | string, idempotencyKey: string) =>
      this.request(
        PublishResult,
        this.apiBaseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/revisions/${encodeURIComponent(revisionId)}/publish`,
        {
          method: "POST",
          idempotencyKey,
        },
      ),
    list: (artifactId: ArtifactId | string) =>
      this.request(RevisionListResponse, this.apiBaseUrl, `/v1/artifacts/${encodeURIComponent(artifactId)}/revisions`),
  };

  web = {
    keys: {
      // Mints a scoped API key from a WorkOS member/CLI access token. The login
      // flow constructs an ApiClient with bearer auth for this single call, then
      // discards the access token (ADR 0060).
      create: (body: CreateApiKeyRequest, idempotencyKey: string) =>
        this.request(CreateApiKeyResponse, this.apiBaseUrl, "/v1/web/keys", {
          method: "POST",
          body,
          idempotencyKey,
          auth: "bearer",
        }),
    },
  };

  admin = {
    workspaces: {
      create: (body: CreateWorkspaceRequest, idempotencyKey: string) =>
        this.request(WorkspaceDetail, this.adminBaseUrl, "/admin/workspaces", {
          method: "POST",
          body,
          idempotencyKey,
          auth: "admin_token",
        }),
      list: (query: Partial<PaginationRequest> = {}) =>
        this.request(WorkspaceListResponse, this.adminBaseUrl, `/admin/workspaces${queryString(query)}`, {
          auth: "admin_token",
        }),
    },
    apiKeys: {
      create: (workspaceId: WorkspaceId | string, body: CreateApiKeyRequest, idempotencyKey: string) =>
        this.request(
          CreateApiKeyResponse,
          this.adminBaseUrl,
          `/admin/workspaces/${encodeURIComponent(workspaceId)}/api-keys`,
          {
            method: "POST",
            body,
            idempotencyKey,
            auth: "admin_token",
          },
        ),
      list: (query: Partial<PaginationRequest> = {}) =>
        this.request(ApiKeyListResponse, this.adminBaseUrl, `/admin/api-keys${queryString(query)}`, {
          auth: "admin_token",
        }),
      revoke: (apiKeyId: ApiKeyId | string, idempotencyKey: string) =>
        this.request(RevokeApiKeyResponse, this.adminBaseUrl, `/admin/api-keys/${encodeURIComponent(apiKeyId)}`, {
          method: "DELETE",
          idempotencyKey,
          auth: "admin_token",
        }),
    },
    artifacts: {
      list: (query: Record<string, unknown> = {}) =>
        this.request(ArtifactListResponse, this.adminBaseUrl, `/admin/artifacts${queryString(query)}`, {
          auth: "admin_token",
        }),
      get: (artifactId: ArtifactId | string) =>
        this.request(ArtifactDetail, this.adminBaseUrl, `/admin/artifacts/${encodeURIComponent(artifactId)}`, {
          auth: "admin_token",
        }),
      delete: (artifactId: ArtifactId | string, idempotencyKey: string) =>
        this.request(DeleteArtifactResponse, this.adminBaseUrl, `/admin/artifacts/${encodeURIComponent(artifactId)}`, {
          method: "DELETE",
          idempotencyKey,
          auth: "admin_token",
        }),
    },
    cleanup: {
      run: (body: CleanupRunRequest, idempotencyKey: string) =>
        this.request(CleanupRunResponse, this.adminBaseUrl, "/admin/cleanup/run", {
          method: "POST",
          body,
          idempotencyKey,
          auth: "admin_token",
        }),
    },
    operationEvents: {
      list: (query: Record<string, unknown> = {}) =>
        this.request(OperationEventListResponse, this.adminBaseUrl, `/admin/operation-events${queryString(query)}`, {
          auth: "admin_token",
        }),
    },
  };

  async putFile(url: string, bytes: BodyInit, headers: Record<string, string> = {}) {
    const response = await this.fetchImpl(url, {
      method: "PUT",
      body: bytes,
      headers,
    });
    if (!response.ok) {
      await throwResponseError(response);
    }
  }

  private async request<Output>(
    schema: Schema<Output>,
    baseUrl: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Output> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const authHeader = await this.authorizationHeader(options.auth ?? "api_key");
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    const response = await this.fetchImpl(`${baseUrl}${path}`, init);

    if (!response.ok) {
      await throwResponseError(response);
    }

    const text = await response.text();
    const data = text.length === 0 ? {} : JSON.parse(text);
    return schema.parse(data);
  }

  private async authorizationHeader(auth: "api_key" | "admin_token" | "bearer" | "none") {
    if (auth === "none") {
      return undefined;
    }
    if (auth === "admin_token") {
      if (!this.adminToken) {
        throw new AgentPasteError({
          code: "not_authenticated",
          message: "Set AGENT_PASTE_ADMIN_TOKEN for admin commands.",
          status: 401,
        });
      }
      return `Bearer ${this.adminToken}`;
    }
    if (auth === "bearer") {
      if (this.auth?.type !== "bearer") {
        throw new AgentPasteError({
          code: "not_authenticated",
          message: "This request requires a bearer access-token provider.",
          status: 401,
        });
      }
      return `Bearer ${await this.auth.getAccessToken()}`;
    }
    if (!this.auth) {
      throw new AgentPasteError({
        code: "not_authenticated",
        message: "Set AGENT_PASTE_API_KEY or pass an auth provider.",
        status: 401,
      });
    }
    if (this.auth.type === "api_key") {
      return `Bearer ${this.auth.apiKey}`;
    }
    return `Bearer ${await this.auth.getAccessToken()}`;
  }
}

function authFromEnv(): AgentPasteAuth | undefined {
  return process.env.AGENT_PASTE_API_KEY ? { type: "api_key", apiKey: process.env.AGENT_PASTE_API_KEY } : undefined;
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function queryString(query: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function throwResponseError(response: Response): Promise<never> {
  const text = await response.text();
  try {
    const raw = JSON.parse(text);
    const parsed = ErrorEnvelope.safeParse(raw);
    if (!parsed.success && isErrorEnvelopeLike(raw)) {
      throw new AgentPasteError({
        code: raw.error.code,
        message: raw.error.message,
        status: response.status,
        requestId: raw.error.request_id,
        ...(raw.error.docs ? { docs: raw.error.docs } : {}),
      });
    }
    if (!parsed.success) {
      throw parsed.error;
    }
    throw new AgentPasteError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      status: response.status,
      ...(parsed.data.error.request_id ? { requestId: parsed.data.error.request_id } : {}),
      ...(parsed.data.error.docs ? { docs: parsed.data.error.docs } : {}),
    });
  } catch (error) {
    if (error instanceof AgentPasteError) {
      throw error;
    }
    throw new AgentPasteError({
      code: "http_error",
      message: text || `HTTP ${response.status}`,
      status: response.status,
    });
  }
}

function isErrorEnvelopeLike(
  value: unknown,
): value is { error: { code: string; message: string; request_id: string; docs?: string } } {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { request_id?: unknown }).request_id === "string"
  );
}

export function createIdempotencyKey(prefix = "cli"): IdempotencyKey {
  return `${prefix}_${crypto.randomUUID()}` as IdempotencyKey;
}
