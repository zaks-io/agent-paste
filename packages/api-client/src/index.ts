import {
  type AccessLinkId,
  AccessLinkSignedUrl,
  AgentView,
  ArtifactFileContent,
  type ArtifactId,
  type ClaimCode,
  type CreateAccessLinkRequest,
  CreateAccessLinkResponse,
  type CreateApiKeyRequest,
  CreateApiKeyResponse,
  type CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  EphemeralProvisionResponse,
  ErrorEnvelope,
  FinalizeUploadSessionResponse,
  type IdempotencyKey,
  McpListAccessLinksOutput,
  McpRevokeAccessLinkOutput,
  PublishResult,
  type PublishRevisionRequest,
  type RevisionId,
  RevisionListResponse,
  RevokeApiKeyResponse,
  trimTrailingSlashes,
  type UploadSessionId,
  UsagePolicy,
  WhoamiResponse,
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
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  auth?: "api_key" | "bearer" | "none";
  headers?: Record<string, string>;
};

// Stable sentinel for the CLI to replace with a channel-correct login hint.
export const CLIENT_AUTH_HANDOFF_HINT = "Run agent-paste login or use --ephemeral for an accountless handoff." as const;

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

  private readonly auth: AgentPasteAuth | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ApiClientOptions = {}) {
    this.auth = options.auth ?? authFromEnv();
    this.apiBaseUrl = options.apiBaseUrl ? normalizeBaseUrl(options.apiBaseUrl) : resolveApiBaseUrl();
    this.uploadBaseUrl = normalizeBaseUrl(
      options.uploadBaseUrl ?? process.env.AGENT_PASTE_UPLOAD_URL ?? "https://upload.agent-paste.sh",
    );
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  whoami() {
    return this.request(WhoamiResponse, this.apiBaseUrl, "/v1/whoami");
  }

  usagePolicy() {
    return this.request(UsagePolicy, this.apiBaseUrl, "/v1/usage-policy");
  }

  apiKeys = {
    revokeCurrent: () =>
      this.request(RevokeApiKeyResponse, this.apiBaseUrl, "/v1/api-keys/current/revoke", { method: "POST" }),
  };

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

  accessLinks = {
    // Create an Access Link for an Artifact and mint its signed URL. Two calls:
    // create the link, then mint its Access Link Signed URL.
    create: (artifactId: ArtifactId | string, body: CreateAccessLinkRequest, idempotencyKey: string) =>
      this.request(
        CreateAccessLinkResponse,
        this.apiBaseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/access-links`,
        {
          method: "POST",
          body,
          idempotencyKey,
        },
      ),
    mint: (accessLinkId: AccessLinkId | string) =>
      this.request(AccessLinkSignedUrl, this.apiBaseUrl, `/v1/access-links/${encodeURIComponent(accessLinkId)}/mint`, {
        method: "POST",
      }),
    list: (artifactId: ArtifactId | string) =>
      this.request(
        McpListAccessLinksOutput,
        this.apiBaseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/access-links`,
      ),
    revoke: (accessLinkId: AccessLinkId | string) =>
      this.request(
        McpRevokeAccessLinkOutput,
        this.apiBaseUrl,
        `/v1/access-links/${encodeURIComponent(accessLinkId)}/revoke`,
        { method: "POST" },
      ),
  };

  revisions = {
    publish: (
      artifactId: ArtifactId | string,
      revisionId: RevisionId | string,
      idempotencyKey: string,
      body?: PublishRevisionRequest,
    ) =>
      this.request(
        PublishResult,
        this.apiBaseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/revisions/${encodeURIComponent(revisionId)}/publish`,
        {
          method: "POST",
          ...(body ? { body } : {}),
          idempotencyKey,
        },
      ),
    list: (artifactId: ArtifactId | string) =>
      this.request(RevisionListResponse, this.apiBaseUrl, `/v1/artifacts/${encodeURIComponent(artifactId)}/revisions`),
  };

  artifacts = {
    // Resolve a base revision's identity (revision_id, entrypoint, title, file tree)
    // from the Agent View — the read half of a patch revise (ADR 0091).
    getAgentView: (artifactId: ArtifactId | string) =>
      this.request(AgentView, this.apiBaseUrl, `/v1/artifacts/${encodeURIComponent(artifactId)}/agent-view`),
    // Read one stored file's decrypted plaintext + sha256 so the caller can diff
    // against it for a patch revise (ADR 0090). revisionId pins the read
    // to a specific Revision; omit for the latest.
    readFile: (artifactId: ArtifactId | string, path: string, revisionId?: RevisionId | string) => {
      const query = new URLSearchParams({ path });
      if (revisionId) {
        query.set("revision_id", String(revisionId));
      }
      return this.request(
        ArtifactFileContent,
        this.apiBaseUrl,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/file-content?${query.toString()}`,
      );
    },
  };

  ephemeral = {
    provision: (options: EphemeralProvisionOptions = {}) => this.provisionEphemeralWorkspace(options),
  };

  web = {
    keys: {
      // Creates a scoped CLI credential from a WorkOS member/CLI access token.
      // The login flow uses bearer auth for this single call, then discards the
      // access token.
      create: (body: CreateApiKeyRequest, idempotencyKey: string) =>
        this.request(CreateApiKeyResponse, this.apiBaseUrl, "/v1/web/keys", {
          method: "POST",
          body,
          idempotencyKey,
          auth: "bearer",
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

  private async provisionEphemeralWorkspace(options: EphemeralProvisionOptions): Promise<EphemeralProvisionResponse> {
    return await this.request(EphemeralProvisionResponse, this.apiBaseUrl, "/v1/ephemeral/provision", {
      method: "POST",
      body: options.claimCode ? { claim_code: options.claimCode } : {},
      auth: "none",
    });
  }

  private async request<Output>(
    schema: Schema<Output>,
    baseUrl: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Output> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.defaultHeaders,
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
      const text = await response.text();
      let data: unknown = {};
      try {
        data = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        throw new AgentPasteError({
          code: "http_error",
          message: text || `HTTP ${response.status}`,
          status: response.status,
        });
      }
      await throwParsedResponseError(response, text, data);
    }

    const text = await response.text();
    const data = text.length === 0 ? {} : JSON.parse(text);
    return schema.parse(data);
  }

  private async authorizationHeader(auth: "api_key" | "bearer" | "none") {
    if (auth === "none") {
      return undefined;
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
        message: CLIENT_AUTH_HANDOFF_HINT,
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
  return trimTrailingSlashes(url);
}

// The API base URL the CLI talks to, from AGENT_PASTE_API_URL or the production
// default. Exported so out-of-band callers (e.g. the CLI update check) resolve
// it identically to the client itself.
export function resolveApiBaseUrl(): string {
  return normalizeBaseUrl(process.env.AGENT_PASTE_API_URL ?? "https://api.agent-paste.sh");
}

async function throwResponseError(response: Response): Promise<never> {
  const text = await response.text();
  let raw: unknown = {};
  try {
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new AgentPasteError({
      code: "http_error",
      message: text || `HTTP ${response.status}`,
      status: response.status,
    });
  }
  return throwParsedResponseError(response, text, raw);
}

async function throwParsedResponseError(response: Response, text: string, raw: unknown): Promise<never> {
  try {
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

export type EphemeralProvisionOptions = {
  /** @deprecated Ignored after PoW removal; kept temporarily for source compatibility. */
  maxPowAttempts?: number;
  /** Optional public claim code from a copied marketing prompt. */
  claimCode?: ClaimCode;
};

export function createIdempotencyKey(prefix = "cli"): IdempotencyKey {
  return `${prefix}_${crypto.randomUUID()}` as IdempotencyKey;
}

export {
  type PublishFile,
  type PublishInput,
  type PublishOutcome,
  type PublishTransport,
  runPublish,
  type UploadStats,
} from "./publish.js";
