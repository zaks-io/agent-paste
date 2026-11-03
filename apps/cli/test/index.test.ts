import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentPasteError } from "@agent-paste/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Credential } from "../src/credentials.js";
import * as credentials from "../src/credentials.js";
import { isMainEntrypoint, logout, main, parseArgs, SCHEMA_VERSION, shellQuote } from "../src/index.js";
import { exitCodeFor } from "../src/render.js";
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
const artifactUrl = "https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/";

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
  it("routes login --device-code to the remote authorization endpoint", async () => {
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));

    await expect(main(["login", "--device-code"])).rejects.toThrow(
      "Device authorization request returned an invalid response.",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://soulful-path-50.authkit.app/oauth2/device_authorization",
      expect.objectContaining({ method: "POST" }),
    );
  });

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
    expect(stdoutValues(stdout).join("")).toContain("authenticated");
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

  it("routes publish help to the dedicated agent guide", async () => {
    const stdout = mockStdout();

    await main(["publish", "--help"]);
    await main(["help", "publish"]);

    const outputs = stdoutValues(stdout);
    expect(outputs).toHaveLength(2);
    for (const help of outputs) {
      expect(help).toContain("agent-paste publish <path>");
      expect(help).toContain("url");
    }
  });

  it("routes both pull help forms to the dedicated guide", async () => {
    const stdout = mockStdout();

    await main(["pull", "--help"]);
    await main(["help", "pull"]);

    const outputs = stdoutValues(stdout);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toBe(outputs[1]);
    for (const help of outputs) {
      expect(help).toContain("agent-paste pull help");
      expect(help).toContain("--json");
    }
  });

  it("documents agent-facing publish contract tokens in publish help", async () => {
    const stdout = mockStdout();

    await main(["help", "publish"]);

    const help = stdoutValues(stdout).join("");
    expect(help).toContain("agent-paste publish <path>");
    expect(help).toContain("agent-paste publish <path> --ephemeral --json");
    expect(help).toContain("url");
    expect(help).toContain("upload_stats");
    expect(help).toContain("claim_url");
    expect(help).toContain("--entrypoint <path>");
    expect(help).not.toContain("--share");
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
    expect(JSON.parse(stdoutValues(stdout).join(""))).toMatchObject({ authenticated: true });
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

  it("rejects removed publish flags before reading files or calling the API", async () => {
    const client = fakeClient({ usagePolicy: vi.fn() });

    await expect(main(["publish", "./report", "--share", "--json"], client)).rejects.toMatchObject({
      code: "invalid_request",
      message: "Unknown option: --share",
    });
    expect(client.usagePolicy).not.toHaveBeenCalled();
  });

  it("rejects --claim-code without --ephemeral before reading files or calling the API", async () => {
    const client = fakeClient({ usagePolicy: vi.fn() });

    await expect(
      main(["publish", "./report", "--claim-code", "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD"], client),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(client.usagePolicy).not.toHaveBeenCalled();
  });

  it("rejects invalid publish metadata before calling the API", async () => {
    const client = fakeClient({ usagePolicy: vi.fn() });

    await expect(main(["publish", "./report", "--title", "forged\u001b[31moutput"], client)).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(client.usagePolicy).not.toHaveBeenCalled();
  });

  it("rejects an empty Artifact ID before calling the API", async () => {
    const client = fakeClient({ usagePolicy: vi.fn() });

    await expect(main(["publish", "./report", "--artifact-id="], client)).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(client.usagePolicy).not.toHaveBeenCalled();
  });

  it("enforces publish caps before looking up an existing Artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-preflight-cap-"));
    try {
      const input = path.join(root, "large.html");
      await fs.writeFile(input, "");
      await fs.truncate(input, usagePolicy.file_size_cap_bytes + 1);
      const getAgentView = vi.fn();
      const client = fakeClient({
        artifacts: { getAgentView, readFile: vi.fn() },
      });

      await expect(main(["publish", input, "--artifact-id", artifactId], client)).rejects.toMatchObject({
        code: "invalid_request",
        status: 400,
      });

      expect(client.usagePolicy).toHaveBeenCalledOnce();
      expect(getAgentView).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous publish inference before calling the API", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cli-preflight-inference-"));
    try {
      await fs.writeFile(path.join(root, "page.html"), "<h1>Page</h1>");
      await fs.writeFile(path.join(root, "notes.txt"), "notes");
      const getAgentView = vi.fn();
      const client = fakeClient({
        usagePolicy: vi.fn(),
        artifacts: { getAgentView, readFile: vi.fn() },
      });

      await expect(main(["publish", root, "--artifact-id", artifactId], client)).rejects.toMatchObject({
        code: "invalid_request",
        status: 400,
      });

      expect(client.usagePolicy).not.toHaveBeenCalled();
      expect(getAgentView).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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

  it.each([
    artifactUrl,
    "01234-56789-abcde-fghjd",
  ])("pull %s writes the file body to stdout, and --quiet does not suppress it", async (reference) => {
    const body = "line one\nline two\n";
    const contentUrl = "https://content.example.test/v/demo/notes.md";
    const readFile = vi.fn().mockResolvedValue({
      path: "notes.md",
      sha256: "b".repeat(64),
      size_bytes: body.length,
      content_type: "text/markdown",
      is_binary: false,
      body,
    });
    const getAgentView = vi.fn().mockResolvedValue(pullView("notes.md", contentUrl));
    const client = fakeClient({ artifacts: { getAgentView, getRevisionAgentView: vi.fn(), readFile } });

    const stdout = mockStdout();
    await main(["pull", reference, "notes.md"], client);
    expect(stdoutValues(stdout).join("")).toBe(body);
    expect(getAgentView).toHaveBeenCalledWith(reference);
    expect(readFile).toHaveBeenCalledWith(artifactId, "notes.md", revisionId);
    stdout.mockRestore();

    // The body IS the result (cat-like), so --quiet must not suppress it — otherwise
    // `pull … --quiet > file` writes an empty file.
    const quietStdout = mockStdout();
    await main(["pull", reference, "notes.md", "--quiet"], client);
    expect(stdoutValues(quietStdout).join("")).toBe(body);
    quietStdout.mockRestore();
  });

  it("pull reads a file omitted from a truncated Agent View at the same Revision", async () => {
    const view = {
      ...pullView("index.html", "https://content.example.test/v/demo/index.html"),
      files_truncated: true,
      file_count: 101,
    };
    const readFile = vi.fn().mockResolvedValue({
      path: "later/notes.md",
      sha256: "b".repeat(64),
      size_bytes: 7,
      content_type: "text/markdown",
      is_binary: false,
      body: "content",
    });
    const readGrant = vi.fn().mockResolvedValue({
      artifact_id: artifactId,
      revision_id: revisionId,
      content_base_url: "https://content.example.test/v/grant/",
      expires_at: "2026-12-01T00:00:00.000Z",
      file_count: 101,
      size_bytes: 1000,
    });
    const client = fakeClient({ artifacts: { getAgentView: vi.fn().mockResolvedValue(view), readFile, readGrant } });
    const stdout = mockStdout();
    await main(["pull", artifactId, "later/notes.md"], client);
    expect(stdoutValues(stdout).join("")).toBe("content");
    expect(readFile).toHaveBeenCalledWith(artifactId, "later/notes.md", revisionId);
    expect(readGrant).not.toHaveBeenCalled();
    stdout.mockRestore();
    const json = mockStdout();
    await main(["pull", artifactId, "later/notes.md", "--json"], client);
    expect(JSON.parse(stdoutValues(json).join("")).url).toBe("https://content.example.test/v/grant/later/notes.md");
    expect(readGrant).toHaveBeenCalledWith(artifactId, revisionId);
    json.mockRestore();
  });
  it("pull rejects a local destination where a remote Artifact path is required", async () => {
    const readFile = vi.fn();
    const client = fakeClient({ artifacts: { readFile } });

    await expect(main(["pull", artifactId, "/tmp/daily-status-pull-check"], client)).rejects.toThrow(
      /remote-path must be a relative file path inside the Artifact/,
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it("pull refuses a binary file in plain mode", async () => {
    const contentUrl = "https://content.example.test/v/demo/logo.bin";
    const readFile = vi.fn().mockResolvedValue({
      path: "logo.bin",
      sha256: "c".repeat(64),
      size_bytes: 4,
      content_type: "application/octet-stream",
      is_binary: true,
    });
    const client = fakeClient({
      artifacts: {
        getAgentView: vi.fn().mockResolvedValue(pullView("logo.bin", contentUrl)),
        getRevisionAgentView: vi.fn(),
        readFile,
      },
    });
    mockStdout();
    await expect(main(["pull", artifactId, "logo.bin"], client)).rejects.toThrow(/binary/);

    const jsonStdout = mockStdout();
    await main(["pull", artifactId, "logo.bin", "--json"], client);
    expect(JSON.parse(stdoutValues(jsonStdout).join(""))).toMatchObject({
      path: "logo.bin",
      is_binary: true,
      url: contentUrl,
    });
    jsonStdout.mockRestore();
  });

  it("pull refuses a too-large-to-inline text file in plain mode but emits metadata in --json", async () => {
    // The oversize branch returns text metadata with no body (is_binary false, body
    // undefined). Plain mode must refuse it; --json must still emit metadata sans body.
    const oversize = {
      path: "huge.txt",
      sha256: "d".repeat(64),
      size_bytes: 20_000_000,
      content_type: "text/plain",
      is_binary: false,
    };
    const contentUrl = "https://content.example.test/v/demo/huge.txt";
    const client = fakeClient({
      artifacts: {
        getAgentView: vi.fn().mockResolvedValue(pullView("huge.txt", contentUrl)),
        getRevisionAgentView: vi.fn(),
        readFile: vi.fn().mockResolvedValue(oversize),
      },
    });

    mockStdout();
    await expect(main(["pull", artifactId, "huge.txt"], client)).rejects.toThrow(/too large to inline/);

    const jsonStdout = mockStdout();
    await main(["pull", artifactId, "huge.txt", "--json"], client);
    const printed = JSON.parse(stdoutValues(jsonStdout).join(""));
    expect(printed).not.toHaveProperty("body");
    expect(printed).toMatchObject({
      path: "huge.txt",
      is_binary: false,
      size_bytes: 20_000_000,
      url: contentUrl,
    });
    jsonStdout.mockRestore();
  });

  it("pull pins an explicit Revision for both Agent View and file content", async () => {
    const pinnedRevision = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8ZA";
    const readFile = vi.fn().mockResolvedValue({
      path: "notes.md",
      sha256: "e".repeat(64),
      size_bytes: 5,
      content_type: "text/markdown",
      is_binary: false,
      body: "hello",
    });
    const getRevisionAgentView = vi
      .fn()
      .mockResolvedValue(pullView("notes.md", "https://content.example.test/v/pinned/notes.md", pinnedRevision));
    const client = fakeClient({
      artifacts: { getAgentView: vi.fn(), getRevisionAgentView, readFile },
    });

    const stdout = mockStdout();
    await main(["pull", artifactUrl, "notes.md", "--revision-id", pinnedRevision], client);

    expect(stdoutValues(stdout).join("")).toBe("hello");
    expect(getRevisionAgentView).toHaveBeenCalledWith(artifactUrl, pinnedRevision);
    expect(readFile).toHaveBeenCalledWith(artifactId, "notes.md", pinnedRevision);
    stdout.mockRestore();
  });

  it("preserves the not-found error contract when a remote path is absent", async () => {
    const readFile = vi.fn();
    const client = fakeClient({
      artifacts: {
        getAgentView: vi.fn().mockResolvedValue({
          ...pullView("notes.md", "https://content.example.test/v/demo/notes.md"),
          files: [],
        }),
        getRevisionAgentView: vi.fn(),
        readFile,
      },
    });

    const error = await main(["pull", artifactId, "missing.md"], client).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "AgentPasteError",
      code: "not_found",
      status: 404,
    });
    expect(error).toBeInstanceOf(AgentPasteError);
    expect(exitCodeFor(error)).toBe(5);
    expect(readFile).not.toHaveBeenCalled();
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

  it("keeps '=' characters inside inline flag values", () => {
    expect(parseArgs(["publish", "--title=Q3: revenue = plan"]).flags.get("title")).toBe("Q3: revenue = plan");
  });

  it("honors inline boolean flag values and rejects non-boolean ones", () => {
    expect(parseArgs(["whoami", "--json=true"]).global.json).toBe(true);
    expect(parseArgs(["whoami", "--json=false"]).global.json).toBe(false);
    expect(() => parseArgs(["whoami", "--json=yes"])).toThrow(
      'Invalid value for --json: expected true or false, got "yes"',
    );
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
    artifacts: {
      getAgentView: vi.fn().mockResolvedValue({
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "Published",
        entrypoint: "index.html",
        files: [],
        safety_warnings: [],
        bundle: { status: "pending", retry_after_seconds: 5 },
        url: artifactUrl,
      }),
      readFile: vi.fn(),
    },
    apiKeys: {
      revokeCurrent: vi.fn(),
    },
    ...overrides,
  } as unknown as NonNullable<Parameters<typeof main>[1]>;
}

function pullView(filePath: string, url: string, viewRevisionId = revisionId) {
  return {
    artifact_id: artifactId,
    revision_id: viewRevisionId,
    title: "Published",
    entrypoint: filePath,
    files: [{ path: filePath, url }],
    safety_warnings: [],
    bundle: { status: "pending", retry_after_seconds: 5 },
    url: artifactUrl,
  };
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
