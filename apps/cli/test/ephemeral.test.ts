import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, publishEphemeral } from "../src/index.js";

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

describe("cli ephemeral publish", () => {
  it("provisions, publishes, and prints share URL plus claim token separately", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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
      expect(human).toContain("https://app.test/view");
      expect(human).toContain(`Claim Token: ${claimToken}`);
      expect(human).not.toContain(`https://app.test/view/${claimToken}`);
      expect(human).not.toContain(`agent_view/${claimToken}`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("parses --ephemeral and warns when env credentials are present", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("AGENT_PASTE_API_KEY", "ap_pk_preview_ignored_secret");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-warn-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Ephemeral</h1>");
      await publishEphemeral(parsedPublishArgs(root), {
        provision: vi.fn().mockResolvedValue(provisionedCredentials()),
        createPublishClient: () => fakePublishClient(),
      });
      expect(parseArgs(["publish", root, "--ephemeral"]).flags.get("ephemeral")).toBe(true);
      expect(stderr).toHaveBeenCalledWith("agent-paste: --ephemeral ignores AGENT_PASTE_API_KEY.\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects TTLs above the ephemeral one-day cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-ephemeral-ttl-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Ephemeral</h1>");
      await expect(
        publishEphemeral(
          {
            ...parsedPublishArgs(root),
            flags: new Map([["ttl", "7d"]]),
          },
          {
            provision: vi.fn().mockResolvedValue(provisionedCredentials()),
            createPublishClient: () => fakePublishClient(),
          },
        ),
      ).rejects.toThrow("TTL exceeds ephemeral maximum");
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
        Object.assign(new Error("ephemeral_provision_rate_limited"), {
          name: "AgentPasteError",
          code: "ephemeral_provision_rate_limited",
          status: 429,
        }),
      );

      await expect(
        publishEphemeral(parsedPublishArgs(root), {
          provision,
          createPublishClient: () => fakePublishClient(),
        }),
      ).rejects.toThrow("ephemeral_provision_rate_limited");

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
    view_url: "https://app.test/view",
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
