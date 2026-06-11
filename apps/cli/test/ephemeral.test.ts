import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPasteError } from "@agent-paste/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as credentials from "../src/credentials.js";
import { ephemeralClaimUrl, parseArgs, publishEphemeral } from "../src/index.js";

const usagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  bundle_size_cap_bytes: 25 * 1024 * 1024,
  bundles_enabled: true,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86_400,
  default_ttl_seconds: 86_400,
  min_ttl_seconds: 86_400,
  max_ttl_seconds: 86_400,
  live_artifacts_cap: 50,
  live_update_enabled: false,
  daily_new_artifact_allowance: 20,
  lifetime_revision_ceiling: 100,
};

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uploadSessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const claimToken = "ap_ct_preview_claimsecret000000000000000000_abc";
const ephemeralApiKey = "ap_pk_preview_0123456789ABCDEF_ephemeralpublishsecret";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation((_value, callback) => {
    callback?.();
    return true;
  });
}

describe("cli ephemeral publish", () => {
  it("provisions, publishes, and prints a private View plus claim deep link in the hash", async () => {
    const stdout = mockStdout();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("AGENT_PASTE_WEB_URL", "https://app.agent-paste.sh");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Ephemeral</h1>");
      const publishClient = fakePublishClient();
      const provision = vi.fn().mockResolvedValue(provisionedCredentials());

      await publishEphemeral(parsedPublishArgs(root), {
        provision,
        createPublishClient: (apiKeySecret) => {
          expect(apiKeySecret).toBe(ephemeralApiKey);
          return publishClient;
        },
      });

      expect(provision).toHaveBeenCalledOnce();
      const human = String(stdout.mock.calls.at(-1)?.[0]);
      const claimUrl = ephemeralClaimUrl(claimToken);
      expect(claimUrl).toBe(`https://app.agent-paste.sh/claim#${claimToken}`);
      expect(human).toContain("https://app.test/artifacts/art_1");
      expect(human).not.toContain("https://app.test/al/PUBLICLINK123456#secret");
      expect(human).not.toContain("https://content.test/v/token/index.html");
      expect(human).toContain(claimUrl);
      expect(human).not.toContain(`?${claimToken}`);
      expect(human).not.toContain(`https://app.test/view/${claimToken}`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("never sends a client-chosen ttl_seconds on the create call", async () => {
    mockStdout();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-ttl-default-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Ephemeral</h1>");
      const publishClient = fakePublishClient();
      await publishEphemeral(parsedPublishArgs(root), {
        provision: vi.fn().mockResolvedValue(provisionedCredentials()),
        createPublishClient: () => publishClient,
      });
      const createArg = vi.mocked(publishClient.uploadSessions.create).mock.calls[0]?.[0];
      expect(createArg).not.toHaveProperty("ttl_seconds");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("warns when env API key and stored login credentials are present", async () => {
    mockStdout();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("AGENT_PASTE_API_KEY", "ap_pk_preview_ignored_secret");
    vi.spyOn(credentials, "loadCredential").mockResolvedValue({
      api_key: "ap_pk_preview_stored_secret",
      public_id: "0123456789ABCDEF",
      workspace_id: "ws_1",
      member_email: "user@example.test",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-warn-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Ephemeral</h1>");
      await publishEphemeral(parsedPublishArgs(root), {
        provision: vi.fn().mockResolvedValue(provisionedCredentials()),
        createPublishClient: () => fakePublishClient(),
      });
      expect(parseArgs(["publish", root, "--ephemeral"]).flags.get("ephemeral")).toBe(true);
      expect(stderr).toHaveBeenCalledWith("agent-paste: --ephemeral ignores AGENT_PASTE_API_KEY.\n");
      expect(stderr).toHaveBeenCalledWith("agent-paste: --ephemeral ignores the stored login credential.\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces proof-of-work failures after retry without printing secrets", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-pow-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>fail</h1>");
      const provision = vi
        .fn()
        .mockRejectedValue(
          new AgentPasteError({ code: "pow_invalid", message: "pow_invalid", status: 400, requestId: "req_pow" }),
        );

      await expect(
        publishEphemeral(parsedPublishArgs(root), {
          provision,
          createPublishClient: () => fakePublishClient(),
        }),
      ).rejects.toMatchObject({ code: "pow_invalid" });

      const stderrOutput = vi
        .mocked(process.stderr.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join("");
      expect(stderrOutput).not.toContain(claimToken);
      expect(stderrOutput).not.toContain(ephemeralApiKey);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces upload failures without printing secrets", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-upload-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>fail</h1>");
      const publishClient = fakePublishClient();
      publishClient.putFile = vi
        .fn()
        .mockRejectedValue(
          new AgentPasteError({ code: "storage_unavailable", message: "storage_unavailable", status: 503 }),
        );

      await expect(
        publishEphemeral(parsedPublishArgs(root), {
          provision: vi.fn().mockResolvedValue(provisionedCredentials()),
          createPublishClient: () => publishClient,
        }),
      ).rejects.toMatchObject({ code: "storage_unavailable" });

      const stderrOutput = vi
        .mocked(process.stderr.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join("");
      expect(stderrOutput).not.toContain(claimToken);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces provision failures without printing secrets", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-fail-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>fail</h1>");
      const provision = vi.fn().mockRejectedValue(
        new AgentPasteError({
          code: "ephemeral_provision_rate_limited",
          message: "ephemeral_provision_rate_limited",
          status: 429,
        }),
      );

      await expect(
        publishEphemeral(parsedPublishArgs(root), {
          provision,
          createPublishClient: () => fakePublishClient(),
        }),
      ).rejects.toMatchObject({ code: "ephemeral_provision_rate_limited" });

      const stderrOutput = vi
        .mocked(process.stderr.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join("");
      expect(stderrOutput).not.toContain(claimToken);
      expect(stderrOutput).not.toContain(ephemeralApiKey);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("ephemeralClaimUrl", () => {
  it("uses the web app origin with a hash fragment and no query string", () => {
    vi.stubEnv("AGENT_PASTE_WEB_URL", "https://app.agent-paste.sh/");
    expect(ephemeralClaimUrl(claimToken)).toBe(`https://app.agent-paste.sh/claim#${claimToken}`);
    expect(ephemeralClaimUrl(claimToken)).not.toContain("?");
  });
});

function parsedPublishArgs(root: string) {
  return {
    command: ["publish"],
    positionals: [root],
    flags: new Map<string, string | boolean>(),
    global: { json: false, quiet: false },
  };
}

function provisionedCredentials() {
  return {
    api_key_secret: ephemeralApiKey,
    claim_token: claimToken,
    workspace_id: "00000000-0000-4000-8000-000000000099",
    api_key_id: "key_ephemeral",
    claim_token_id: "ct_ephemeral",
  };
}

function fakePublishClient() {
  const create = vi.fn().mockResolvedValue({
    upload_session_id: uploadSessionId,
    artifact_id: artifactId,
    revision_id: revisionId,
    status: "pending",
    expires_at: "2026-01-01T00:00:00.000Z",
    files: [
      {
        status: "upload_required",
        path: "index.html",
        put_url: "https://upload.test/index",
        required_headers: {},
        expires_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  const finalize = vi.fn().mockResolvedValue({
    upload_session_id: uploadSessionId,
    artifact_id: artifactId,
    revision_id: revisionId,
    status: "draft",
    title: "Published",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 14,
  });
  const publish = vi.fn().mockResolvedValue({
    artifact_id: artifactId,
    revision_id: revisionId,
    title: "Published",
    artifact_url: "https://app.test/artifacts/art_1",
    revision_content_url: "https://content.test/v/token/index.html",
    agent_view_url: "https://api.test/agent-view/token",
    expires_at: "2026-02-01T00:00:00.000Z",
  });
  return {
    whoami: vi.fn(),
    usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
    putFile: vi.fn().mockResolvedValue(undefined),
    uploadSessions: { create, finalize },
    revisions: { publish },
    apiKeys: { revokeCurrent: vi.fn() },
  } as unknown as import("@agent-paste/api-client").ApiClient;
}
