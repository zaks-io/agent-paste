import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Credential } from "../src/credentials.js";
import * as credentials from "../src/credentials.js";
import { isMainEntrypoint, logout, main, parseArgs, SCHEMA_VERSION, shellQuote } from "../src/index.js";
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
const accessLinkId = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

// Sandbox the per-artifact manifest cache (ADR 0090) so publish tests do
// not write to the developer's real ~/.config/agent-paste.
let configHome: string | undefined;
let previousConfigHome: string | undefined;

beforeEach(async () => {
  previousConfigHome = process.env.XDG_CONFIG_HOME;
  configHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cfg-"));
  process.env.XDG_CONFIG_HOME = configHome;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousConfigHome;
  }
  if (configHome) {
    await fs.rm(configHome, { recursive: true, force: true });
  }
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

describe("shellQuote (Update-command path safety)", () => {
  it("leaves shell-safe paths bare", () => {
    expect(shellQuote("./report")).toBe("./report");
    expect(shellQuote("examples/local-harness/site")).toBe("examples/local-harness/site");
  });

  it("single-quotes paths with spaces or shell-significant chars", () => {
    expect(shellQuote("./My Reports/site")).toBe("'./My Reports/site'");
    expect(shellQuote("a;b")).toBe("'a;b'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's/site")).toBe("'it'\\''s/site'");
  });
});

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

  it("routes a --help flag on a subcommand to help instead of running it", async () => {
    const stdout = mockStdout();

    // `publish --help` (and any other subcommand) must print help without
    // requiring the positional path or resolving a client — passing no client
    // would throw on a real publish attempt.
    await main(["publish", "--help"]);
    await main(["whoami", "--help"]);

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

    const parsed = JSON.parse(stdoutValues(stdout).join(""));
    expect(parsed.version).toBe(CLI_VERSION);
    expect(parsed.schema_version).toBe(SCHEMA_VERSION);
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

    // Contract: exactly one stdout write, valid JSON carrying the command payload
    // plus the schema version, and nothing leaked to stderr. Not byte-equality —
    // the exact key order / version stamp is allowed to evolve.
    expect(stdout).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdoutValues(stdout).join(""));
    expect(parsed).toMatchObject(payload);
    expect(parsed.schema_version).toBe(SCHEMA_VERSION);
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

  it("prints a channel-correct signed-out hint for whoami", async () => {
    const stdout = mockStdout();
    const previousKey = process.env.AGENT_PASTE_API_KEY;
    const previousUserAgent = process.env.npm_config_user_agent;
    delete process.env.AGENT_PASTE_API_KEY;
    process.env.npm_config_user_agent = "npm/10 npx/10";
    vi.spyOn(credentials, "loadCredential").mockResolvedValue(null);
    try {
      await main(["whoami"]);
    } finally {
      if (previousKey === undefined) delete process.env.AGENT_PASTE_API_KEY;
      else process.env.AGENT_PASTE_API_KEY = previousKey;
      if (previousUserAgent === undefined) delete process.env.npm_config_user_agent;
      else process.env.npm_config_user_agent = previousUserAgent;
    }

    const text = stdoutValues(stdout).join("");
    expect(text).toContain("npx @zaks-io/agent-paste login");
    expect(text).toContain("npx @zaks-io/agent-paste publish --ephemeral");
    expect(text).not.toContain("`agent-paste ");
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
        private_url: "https://app.test/v/art_1",
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
          files: [
            expect.objectContaining({
              path: "index.html",
              size_bytes: 14,
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ],
        }),
        expect.stringMatching(/^cli_publish_/),
      );
      // Without --render-mode the field must be omitted so the server infers it.
      expect(create.mock.calls[0]?.[0]).not.toHaveProperty("render_mode");
      const idempotencyKey = create.mock.calls[0]?.[1];
      expect(putFile).toHaveBeenCalledWith("https://upload.test/index", expect.any(Buffer), {
        "content-type": "text/html; charset=utf-8",
      });
      expect(finalize).toHaveBeenCalledWith(uploadSessionId, idempotencyKey);
      // Publish is content-only: the revision-publish body is always omitted (undefined).
      expect(publish).toHaveBeenCalledWith(artifactId, revisionId, idempotencyKey, undefined);
      // Human output defaults to the private/authenticated app View, and surfaces
      // the artifact id only as the --artifact-id revise handle (so the agent edits
      // in place instead of republishing). The revision id and snapshot URLs stay
      // on the JSON surface.
      const out = stdoutValues(stdout).join("");
      expect(out).toContain("https://app.test/v/art_1");
      expect(out).toContain(`--artifact-id ${artifactId}`);
      expect(out).not.toContain(revisionId);
      expect(out).not.toContain("https://content.test/v/token/index.html");
      // Upload summary surfaces the count uploaded and that nothing was reused —
      // assert the facts, not the exact label/spacing/byte rendering.
      expect(out).toMatch(/1\/1/);
      expect(out).toMatch(/reused|cached/);
    } finally {
      await removePublishFixture(root);
    }
  });

  it("make-public creates and mints a public Share Link for an artifact", async () => {
    const stdout = mockStdout();
    const accessLinkCreate = vi.fn().mockResolvedValue({
      id: accessLinkId,
      type: "share",
      artifact_id: artifactId,
      revision_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const accessLinkMint = vi.fn().mockResolvedValue({ url: "https://app.test/al/PUBLICLINK123456#secret" });
    const client = fakeClient({
      accessLinks: { create: accessLinkCreate, mint: accessLinkMint },
    });

    await main(["make-public", artifactId, "--json"], client);

    expect(accessLinkCreate).toHaveBeenCalledWith(
      artifactId,
      { type: "share" },
      expect.stringMatching(/^cli_make_public_/),
    );
    expect(accessLinkMint).toHaveBeenCalledWith(accessLinkId);
    const payload = JSON.parse(stdoutValues(stdout).join("")) as {
      artifact_id: string;
      access_link_id: string;
      public_url: string;
    };
    expect(payload.artifact_id).toBe(artifactId);
    expect(payload.access_link_id).toBe(accessLinkId);
    expect(payload.public_url).toBe("https://app.test/al/PUBLICLINK123456#secret");
  });

  it("skips reused upload targets and reports upload stats", async () => {
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
        files: [{ status: "reused", path: "index.html" }],
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
        private_url: "https://app.test/v/art_1",
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

      await main(["publish", root, "--entrypoint=index.html", "--render-mode", "html", "--json"], client);

      expect(putFile).not.toHaveBeenCalled();
      const payload = JSON.parse(stdoutValues(stdout).join("")) as {
        upload_stats: unknown;
        private_url: string;
      };
      expect(payload.upload_stats).toEqual({
        total_files: 1,
        total_bytes: 14,
        uploaded_files: 0,
        uploaded_bytes: 0,
        reused_files: 1,
        reused_bytes: 14,
      });
      // Content-only, private publish surface: one private viewer link (`/v/<id>`),
      // the same shape MCP returns. No `shared` bit, and the old `access_link_url`
      // / `artifact_url` / `viewer_url` fields must not leak.
      expect(payload.private_url.endsWith("/v/art_1")).toBe(true);
      expect(payload).not.toHaveProperty("shared");
      expect(payload).not.toHaveProperty("viewer_url");
      expect(payload).not.toHaveProperty("access_link_url");
      expect(payload).not.toHaveProperty("artifact_url");
    } finally {
      await removePublishFixture(root);
    }
  });

  it("transmits render_mode only when --render-mode is passed, and rejects junk values", async () => {
    mockStdout();
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
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/token/index.html",
        agent_view_url: "https://api.test/agent-view",
        expires_at: "2026-02-01T00:00:00.000Z",
      });
      const client = fakeClient({
        usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
        uploadSessions: { create, finalize },
        revisions: { publish },
        putFile: vi.fn().mockResolvedValue(undefined),
      });

      await main(["publish", root, "--render-mode", "markdown"], client);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ render_mode: "markdown" }),
        expect.stringMatching(/^cli_publish_/),
      );

      await expect(main(["publish", root, "--render-mode", "quicktime"], client)).rejects.toThrow();
      expect(create).toHaveBeenCalledTimes(1);
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
            files: [{ status: "upload_required", path: "missing.html", put_url: "https://upload.test/missing" }],
          }),
          finalize: vi.fn(),
        },
      });

      await expect(main(["publish", root, "--entrypoint=index.html", "--render-mode", "html"], client)).rejects.toThrow(
        /unknown file.*missing\.html/,
      );
    } finally {
      await removePublishFixture(root);
    }
  });

  it("retries a revise as a full whole-blob publish when the cached base is unusable", async () => {
    mockStdout();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
      // Seed a manifest cache for this artifact whose base the server will reject.
      const manifests = path.join(configHome ?? "", "agent-paste", "manifests");
      await fs.mkdir(manifests, { recursive: true });
      const staleRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
      await fs.writeFile(
        path.join(manifests, `${encodeURIComponent(artifactId)}.json`),
        JSON.stringify({
          revision_id: staleRevisionId,
          files: [{ path: "gone.html", sha256: "a".repeat(64), size_bytes: 5 }],
        }),
      );
      const sessionResponse = {
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
      };
      const create = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("patch_conflict"), { code: "patch_conflict" }))
        .mockResolvedValueOnce(sessionResponse);
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
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/token/index.html",
        agent_view_url: "https://api.test/agent-view",
        expires_at: "2026-02-01T00:00:00.000Z",
      });
      const client = fakeClient({
        usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
        uploadSessions: { create, finalize },
        revisions: { publish },
        putFile: vi.fn().mockResolvedValue(undefined),
      });

      await main(["publish", root, "--artifact-id", artifactId], client);

      expect(create).toHaveBeenCalledTimes(2);
      // First attempt used the cached base; the retry dropped it and sent a full manifest.
      expect(create.mock.calls[0]?.[0]).toMatchObject({ base_revision_id: staleRevisionId });
      expect(create.mock.calls[1]?.[0]).not.toHaveProperty("base_revision_id");
    } finally {
      await removePublishFixture(root);
    }
  });

  it("self-heals when finalize collapses a base-unusable error to invalid_request", async () => {
    // The base-* repository kinds reach the wire as code `invalid_request` with the kind
    // attached as the message detail (ADR 0090). This proves the CLI keys on that detail —
    // rejecting on `finalize` (where base errors realistically fire), not `create`, and with
    // a bare `invalid_request` code, so it fails if the detail signal regresses.
    mockStdout();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-"));
    try {
      await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
      const manifests = path.join(configHome ?? "", "agent-paste", "manifests");
      await fs.mkdir(manifests, { recursive: true });
      const staleRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
      await fs.writeFile(
        path.join(manifests, `${encodeURIComponent(artifactId)}.json`),
        JSON.stringify({
          revision_id: staleRevisionId,
          files: [{ path: "gone.html", sha256: "a".repeat(64), size_bytes: 5 }],
        }),
      );
      const sessionResponse = {
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
      };
      const create = vi.fn().mockResolvedValue(sessionResponse);
      const finalize = vi
        .fn()
        // Collapsed wire shape: code is the generic invalid_request; the precise kind is the message.
        .mockRejectedValueOnce(Object.assign(new Error("base_revision_not_found"), { code: "invalid_request" }))
        .mockResolvedValueOnce({
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
        private_url: "https://app.test/v/art_1",
        revision_content_url: "https://content.test/v/token/index.html",
        agent_view_url: "https://api.test/agent-view",
        expires_at: "2026-02-01T00:00:00.000Z",
      });
      const client = fakeClient({
        usagePolicy: vi.fn().mockResolvedValue(usagePolicy),
        uploadSessions: { create, finalize },
        revisions: { publish },
        putFile: vi.fn().mockResolvedValue(undefined),
      });

      await main(["publish", root, "--artifact-id", artifactId], client);

      expect(create).toHaveBeenCalledTimes(2);
      expect(finalize).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[0]?.[0]).toMatchObject({ base_revision_id: staleRevisionId });
      expect(create.mock.calls[1]?.[0]).not.toHaveProperty("base_revision_id");
    } finally {
      await removePublishFixture(root);
    }
  });

  it("pull writes the file body to stdout, and --quiet does not suppress it", async () => {
    const body = "line one\nline two\n";
    const readFile = vi.fn().mockResolvedValue({
      path: "notes.md",
      sha256: "b".repeat(64),
      size_bytes: body.length,
      content_type: "text/markdown",
      is_binary: false,
      body,
    });
    const client = fakeClient({ artifacts: { readFile } });

    const stdout = mockStdout();
    await main(["pull", artifactId, "notes.md"], client);
    expect(stdoutValues(stdout).join("")).toBe(body);
    stdout.mockRestore();

    // The body IS the result (cat-like), so --quiet must not suppress it — otherwise
    // `pull … --quiet > file` writes an empty file.
    const quietStdout = mockStdout();
    await main(["pull", artifactId, "notes.md", "--quiet"], client);
    expect(stdoutValues(quietStdout).join("")).toBe(body);
    quietStdout.mockRestore();
  });

  it("pull refuses a binary file in plain mode", async () => {
    const readFile = vi.fn().mockResolvedValue({
      path: "logo.bin",
      sha256: "c".repeat(64),
      size_bytes: 4,
      content_type: "application/octet-stream",
      is_binary: true,
    });
    const client = fakeClient({ artifacts: { readFile } });
    mockStdout();
    await expect(main(["pull", artifactId, "logo.bin"], client)).rejects.toThrow(/binary/);
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
      expect.arrayContaining([expect.stringContaining("Revoked and removed stored credential")]),
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
