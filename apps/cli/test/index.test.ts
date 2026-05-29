import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credential } from "../src/credentials.js";
import { logout, main, parseArgs } from "../src/index.js";

const usagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  bundle_size_cap_bytes: 25 * 1024 * 1024,
  bundles_enabled: true,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86_400,
  default_ttl_seconds: 2_592_000,
  min_ttl_seconds: 86_400,
  max_ttl_seconds: 7_776_000,
  live_artifacts_cap: 50,
  live_update_enabled: false,
};

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uploadSessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli command dispatch", () => {
  it("prints help without resolving a client", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await main(["help"]);
    await main(["--help"]);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("agent-paste publish <path>"));
  });

  it("prints whoami as JSON", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const client = fakeClient({
      whoami: vi.fn().mockResolvedValue({ actor: { id: "key_1" }, workspace: { name: "Demo" } }),
    });

    await main(["whoami", "--json"], client);

    expect(client.whoami).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"workspace"'));
  });

  it("publishes a local folder through create, PUT, and finalize", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
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
        agent_view_url: "https://api.test/agent-view",
        expires_at: "2026-02-01T00:00:00.000Z",
      });
      const putFile = vi.fn().mockResolvedValue(undefined);
      const client = fakeClient({
        usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
        uploadSessions: { create, finalize },
        revisions: { publish },
        putFile,
      });

      await main(["publish", root, "--title", "Published"], client);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Published",
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 14 }],
        }),
        expect.stringMatching(/^cli_publish_/),
      );
      const idempotencyKey = create.mock.calls[0]?.[1];
      expect(putFile).toHaveBeenCalledWith("https://upload.test/index", expect.any(Buffer), {
        "content-type": "text/html; charset=utf-8",
      });
      expect(finalize).toHaveBeenCalledWith(uploadSessionId, idempotencyKey);
      expect(publish).toHaveBeenCalledWith(artifactId, revisionId, idempotencyKey);
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining(`Published artifact ${artifactId} revision ${revisionId}`),
      );
    } finally {
      await removePublishFixture(root);
    }
  });

  it("rejects publish TTLs below the workspace minimum", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
      const client = fakeClient({ usagePolicy: vi.fn().mockResolvedValue(usagePolicy) });

      await expect(main(["publish", root, "--ttl", "1h"], client)).rejects.toThrow("TTL is below workspace minimum");
    } finally {
      await removePublishFixture(root);
    }
  });

  it("rejects upload sessions that return unknown files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
      const client = fakeClient({
        usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
        uploadSessions: {
          create: vi.fn().mockResolvedValue({
            upload_session_id: uploadSessionId,
            files: [{ path: "missing.html", put_url: "https://upload.test/missing" }],
          }),
          finalize: vi.fn(),
        },
      });

      await expect(
        main(["publish", root, "--entrypoint=index.html", "--render-mode", "html", "--ttl", "2d"], client),
      ).rejects.toThrow("Upload session returned unknown file missing.html");
    } finally {
      await removePublishFixture(root);
    }
  });

  it("throws on unknown commands", async () => {
    await expect(main(["unknown"], fakeClient())).rejects.toThrow("Unknown command: unknown");
  });

  it("parses empty args, negated flags, missing flag values, and empty flag names", () => {
    expect(parseArgs([]).command).toEqual([]);
    expect(parseArgs(["--no-json", "--", "whoami"]).global.json).toBe(false);
    expect(parseArgs(["--=ignored", "help"]).command).toEqual(["help"]);
    expect(() => parseArgs(["publish", "--title"])).toThrow("Missing value for --title");
  });

  it("suppresses human output with --quiet", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const client = fakeClient({ whoami: vi.fn().mockResolvedValue({ ok: true }) });

    await main(["whoami", "--quiet"], client);

    expect(stdout).not.toHaveBeenCalled();
  });

  it("revokes and removes the stored credential on logout", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const remove = vi.fn().mockResolvedValue(undefined);
    const revokeCurrent = vi.fn().mockResolvedValue({ ok: true });

    await logout(
      { json: false, quiet: false },
      {
        load: async () => storedCredential(),
        delete: remove,
        client: fakeClient({ apiKeys: { revokeCurrent } }),
      },
    );

    expect(revokeCurrent).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Revoked and removed stored API key"));
  });

  it("deletes the stored credential and warns when remote logout revoke fails", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const warnings: string[] = [];
    const remove = vi.fn().mockResolvedValue(undefined);

    await logout(
      { json: false, quiet: false },
      {
        load: async () => storedCredential(),
        delete: remove,
        warn: (message) => warnings.push(message),
        client: fakeClient({
          apiKeys: { revokeCurrent: vi.fn().mockRejectedValue(new Error("offline")) },
        }),
      },
    );

    expect(remove).toHaveBeenCalledOnce();
    expect(warnings.join("")).toContain("remote revoke failed");
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Remote revoke failed"));
  });

  it("deletes expired stored credentials without remote revoke", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const remove = vi.fn().mockResolvedValue(undefined);
    const revokeCurrent = vi.fn();

    await logout(
      { json: true, quiet: false },
      {
        load: async () => ({ ...storedCredential(), expires_at: "2026-01-01T00:00:00.000Z" }),
        delete: remove,
        now: new Date("2026-01-01T00:00:00.000Z"),
        client: fakeClient({ apiKeys: { revokeCurrent } }),
      },
    );

    expect(revokeCurrent).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });
});

function fakeClient(overrides: Record<string, unknown> = {}): NonNullable<Parameters<typeof main>[1]> {
  return {
    whoami: vi.fn().mockResolvedValue({ ok: true }),
    usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
    putFile: vi.fn().mockResolvedValue(undefined),
    uploadSessions: {
      create: vi.fn(),
      finalize: vi.fn(),
    },
    revisions: {
      publish: vi.fn(),
      list: vi.fn(),
    },
    apiKeys: {
      revokeCurrent: vi.fn(),
    },
    ...overrides,
  } as unknown as NonNullable<Parameters<typeof main>[1]>;
}

function storedCredential(): Credential {
  return {
    api_key: "ap_pk_preview_secret",
    public_id: "0123456789ABCDEF",
    workspace_id: "ws_1",
    member_email: "user@example.com",
    expires_at: "2026-12-01T00:00:00.000Z",
  };
}

async function removePublishFixture(root: string) {
  await fs.rm(root, { recursive: true, force: true });
}
