import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credential } from "../src/credentials.js";
import * as credentials from "../src/credentials.js";
import { isMainEntrypoint, logout, main, parseArgs } from "../src/index.js";
import { CLI_VERSION } from "../src/version.js";

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
  daily_new_artifact_allowance: 100,
  lifetime_revision_ceiling: 100,
};

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uploadSessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation((_value, callback) => {
    callback?.();
    return true;
  });
}

function stdoutValues(stdout: ReturnType<typeof mockStdout>) {
  return stdout.mock.calls.map(([value]) => String(value));
}

describe("cli command dispatch", () => {
  it("detects the executable entrypoint from a file URL and filesystem path", () => {
    const argv1 = path.join(os.tmpdir(), "agent paste");
    const metaUrl = pathToFileURL(argv1).href;

    expect(isMainEntrypoint(metaUrl, argv1)).toBe(true);
    expect(isMainEntrypoint(metaUrl, argv1.toUpperCase(), "win32")).toBe(true);
    expect(isMainEntrypoint(metaUrl, path.join(os.tmpdir(), "agent-paste-other"))).toBe(false);
  });

  it("detects npm bin symlinks as the executable entrypoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-main-"));
    try {
      const target = path.join(root, "node_modules", "@zaks-io", "agent-paste", "dist", "index.js");
      const bin = path.join(root, "node_modules", ".bin", "agent-paste");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(path.dirname(bin), { recursive: true });
      await fs.writeFile(target, "");
      await fs.symlink("../@zaks-io/agent-paste/dist/index.js", bin);

      expect(isMainEntrypoint(pathToFileURL(target).href, bin)).toBe(true);
      expect(isMainEntrypoint(pathToFileURL(target).href, path.join(root, "node_modules", ".bin", "other"))).toBe(
        false,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prints help without resolving a client", async () => {
    const stdout = mockStdout();

    await main(["help"]);
    await main(["--help"]);

    expect(stdoutValues(stdout)).toEqual(
      expect.arrayContaining([expect.stringContaining("agent-paste publish <path>")]),
    );
  });

  it("reports its version without resolving a client", async () => {
    const stdout = mockStdout();

    // No client passed: version must short-circuit before any auth/client
    // resolution, so this resolves rather than throwing on a missing client.
    await expect(main(["version"])).resolves.toBeUndefined();
    await expect(main(["--version"])).resolves.toBeUndefined();
    await expect(main(["-v"])).resolves.toBeUndefined();

    expect(stdoutValues(stdout)).toContain(`${CLI_VERSION}\n`);
  });

  it("reports its version as JSON", async () => {
    const stdout = mockStdout();

    await main(["version", "--json"]);

    expect(stdoutValues(stdout)).toContain(`${JSON.stringify({ version: CLI_VERSION }, null, 2)}\n`);
  });

  it("routes upgrade without resolving a client and redirects off the binary channel", async () => {
    mockStdout();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExit = process.exitCode;

    // No client passed: upgrade must dispatch before auth resolution. Under
    // vitest the process is not a compiled binary, so it redirects to npm.
    await expect(main(["upgrade"])).resolves.toBeUndefined();

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("standalone binary installs"));
    process.exitCode = previousExit;
  });

  it("does not let `upgrade --version` print the CLI version", async () => {
    const stdout = mockStdout();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExit = process.exitCode;

    // The bare-flag version shortcut is gated on having no subcommand, so this
    // dispatches to upgrade (redirected off-binary here), not the version print.
    await main(["upgrade", "--version"]);

    expect(stdoutValues(stdout)).not.toContain(`${CLI_VERSION}\n`);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("standalone binary installs"));
    process.exitCode = previousExit;
  });

  it("prints whoami as JSON", async () => {
    const stdout = mockStdout();
    const client = fakeClient({
      whoami: vi.fn().mockResolvedValue({ actor: { id: "key_1" }, workspace: { name: "Demo" } }),
    });

    await main(["whoami", "--json"], client);

    expect(client.whoami).toHaveBeenCalledOnce();
    expect(stdoutValues(stdout)).toEqual(expect.arrayContaining([expect.stringContaining('"workspace"')]));
  });

  it("does not let the post-command update check corrupt --json output", async () => {
    const stdout = mockStdout();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const payload = { actor: { id: "key_1" }, workspace: { name: "Demo" } };
    const client = fakeClient({ whoami: vi.fn().mockResolvedValue(payload) });

    // The check runs after dispatch; here it self-suppresses (non-TTY test env),
    // so stdout is exactly the command payload and nothing leaks to stderr. The
    // --json / --quiet suppression itself is proven in update-check.test.ts.
    await main(["whoami", "--json"], client);

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdoutValues(stdout)).toEqual([`${JSON.stringify(payload, null, 2)}\n`]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("reports unauthenticated whoami without hitting the server (exit 0)", async () => {
    const stdout = mockStdout();
    const previousKey = process.env.AGENT_PASTE_API_KEY;
    delete process.env.AGENT_PASTE_API_KEY;
    vi.spyOn(credentials, "loadCredential").mockResolvedValue(null);
    try {
      // No client passed and no creds: must resolve without throwing (exit 0)
      // rather than 401ing against the server.
      await expect(main(["whoami", "--json"])).resolves.toBeUndefined();
    } finally {
      if (previousKey === undefined) delete process.env.AGENT_PASTE_API_KEY;
      else process.env.AGENT_PASTE_API_KEY = previousKey;
    }

    expect(stdoutValues(stdout)).toEqual(expect.arrayContaining([expect.stringContaining('"authenticated": false')]));
  });

  it("publishes a local folder through create, PUT, and finalize", async () => {
    const stdout = mockStdout();
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
        artifact_url: "https://app.test/artifacts/art_1",
        revision_content_url: "https://content.test/v/token/index.html",
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
      // Assert the published identifiers and the human URL reach stdout, not the
      // output's wording or spacing. The format is free to change without this
      // test breaking; what matters is the ids and URL fields are surfaced.
      const out = stdoutValues(stdout).join("");
      expect(out).toContain(artifactId);
      expect(out).toContain(revisionId);
      expect(out).toContain("https://app.test/artifacts/art_1");
      expect(out).toContain("https://content.test/v/token/index.html");
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

      await expect(main(["publish", root, "--entrypoint=index.html", "--render-mode", "html"], client)).rejects.toThrow(
        "Upload session returned unknown file missing.html",
      );
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
    const stdout = mockStdout();
    const client = fakeClient({ whoami: vi.fn().mockResolvedValue({ ok: true }) });

    await main(["whoami", "--quiet"], client);

    expect(stdout).not.toHaveBeenCalled();
  });

  it("revokes and removes the stored credential on logout", async () => {
    const stdout = mockStdout();
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
    expect(stdoutValues(stdout)).toEqual(
      expect.arrayContaining([expect.stringContaining("Revoked and removed stored API key")]),
    );
  });

  it("deletes the stored credential and warns when remote logout revoke fails", async () => {
    const stdout = mockStdout();
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
    expect(stdoutValues(stdout)).toEqual(expect.arrayContaining([expect.stringContaining("Remote revoke failed")]));
  });

  it("deletes expired stored credentials without remote revoke", async () => {
    mockStdout();
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
