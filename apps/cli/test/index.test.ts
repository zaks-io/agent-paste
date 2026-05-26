import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs } from "../src/index.js";

const usagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86_400,
  default_ttl_seconds: 2_592_000,
  min_ttl_seconds: 86_400,
  max_ttl_seconds: 7_776_000,
};

const workspaceId = "00000000-0000-4000-8000-000000000000";
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

  it("creates and lists admin workspaces", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const create = vi.fn().mockResolvedValue({ id: workspaceId, name: "User" });
    const list = vi.fn().mockResolvedValue({ data: [], page_info: { next_cursor: null, has_more: false } });
    const client = fakeClient({ admin: { workspaces: { create, list } } });

    await main(["admin", "workspace", "create", "user@example.com", "--name", "User", "--json"], client);
    await main(["admin", "workspace", "list", "--json"], client);

    expect(create).toHaveBeenCalledWith(
      { email: "user@example.com", name: "User" },
      expect.stringMatching(/^cli_admin_workspace_create_/),
    );
    expect(list).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalled();
  });

  it("creates admin keys with the default CLI name", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const create = vi.fn().mockResolvedValue({ api_key: { id: "key_1" }, secret: "secret" });
    const client = fakeClient({ admin: { apiKeys: { create } } });

    await main(["admin", "key", "create", workspaceId, "--json"], client);

    expect(create).toHaveBeenCalledWith(
      workspaceId,
      { name: "agent-paste CLI" },
      expect.stringMatching(/^cli_admin_key_create_/),
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("dispatches artifact admin aliases", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const list = vi.fn().mockResolvedValue({ data: [] });
    const get = vi.fn().mockResolvedValue({ id: artifactId });
    const client = fakeClient({ admin: { artifacts: { list, get } } });

    await main(["admin", "artifact", "list"], client);
    await main(["list"], client);
    await main(["admin", "artifact", "get", artifactId], client);
    await main(["get", artifactId], client);

    expect(list).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(artifactId);
  });

  it("lists admin operation events", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const list = vi.fn().mockResolvedValue({ data: [] });
    const client = fakeClient({ admin: { operationEvents: { list } } });

    await main(["admin", "events", "list"], client);

    expect(list).toHaveBeenCalledOnce();
  });

  it("requires confirmation for destructive admin commands and dispatches them with --yes", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const revoke = vi.fn().mockResolvedValue({ revoked_at: "2026-01-01T00:00:00.000Z" });
    const deleteArtifact = vi.fn().mockResolvedValue({ deleted_at: "2026-01-01T00:00:00.000Z" });
    const client = fakeClient({ admin: { apiKeys: { revoke }, artifacts: { delete: deleteArtifact } } });

    await expect(main(["admin", "key", "revoke", "key_1"], client)).rejects.toThrow("without --yes");
    await expect(main(["delete", artifactId], client)).rejects.toThrow("without --yes");
    await main(["admin", "key", "revoke", "key_1", "--yes"], client);
    await main(["admin", "artifact", "delete", artifactId, "--yes"], client);

    expect(revoke).toHaveBeenCalledWith("key_1", expect.stringMatching(/^cli_admin_key_revoke_/));
    expect(deleteArtifact).toHaveBeenCalledWith(artifactId, expect.stringMatching(/^cli_admin_artifact_delete_/));
  });

  it("runs admin cleanup in dry-run mode or with explicit confirmation", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const run = vi.fn().mockResolvedValue({ expired_artifacts: 0 });
    const client = fakeClient({ admin: { cleanup: { run } } });

    await main(["admin", "cleanup", "run", "--dry-run"], client);
    await expect(main(["admin", "cleanup", "run"], client)).rejects.toThrow("without --yes");
    await main(["admin", "cleanup", "run", "--yes"], client);

    expect(run).toHaveBeenNthCalledWith(1, { dry_run: true }, expect.stringMatching(/^cli_admin_cleanup_run_/));
    expect(run).toHaveBeenNthCalledWith(2, { dry_run: false }, expect.stringMatching(/^cli_admin_cleanup_run_/));
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
});

function fakeClient(overrides: Record<string, unknown> = {}): NonNullable<Parameters<typeof main>[1]> {
  const { admin: adminOverrides, ...topLevelOverrides } = overrides as Record<string, unknown> & {
    admin?: {
      workspaces?: Record<string, unknown>;
      apiKeys?: Record<string, unknown>;
      artifacts?: Record<string, unknown>;
      cleanup?: Record<string, unknown>;
      operationEvents?: Record<string, unknown>;
    };
  };
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
    ...topLevelOverrides,
    admin: {
      workspaces: {
        create: vi.fn(),
        list: vi.fn(),
        ...(adminOverrides?.workspaces ?? {}),
      },
      apiKeys: {
        create: vi.fn(),
        revoke: vi.fn(),
        ...(adminOverrides?.apiKeys ?? {}),
      },
      artifacts: {
        list: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        ...(adminOverrides?.artifacts ?? {}),
      },
      cleanup: {
        run: vi.fn(),
        ...(adminOverrides?.cleanup ?? {}),
      },
      operationEvents: {
        list: vi.fn(),
        ...(adminOverrides?.operationEvents ?? {}),
      },
    },
  } as unknown as NonNullable<Parameters<typeof main>[1]>;
}

async function removePublishFixture(root: string) {
  await fs.rm(root, { recursive: true, force: true });
}
