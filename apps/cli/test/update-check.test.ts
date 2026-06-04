import { describe, expect, it, vi } from "vitest";
import { compareSemver, detectChannel, runUpdateCheck, upgradeCommand } from "../src/update-check.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

// Deps that always pass the suppression gate: TTY on, no CI/opt-out env, no
// fresh cache. Individual tests override pieces of this.
function liveDeps(overrides: Record<string, unknown> = {}) {
  const stderr = vi.fn();
  const fetchImpl = vi.fn(async () => jsonResponse({ latest: "1.0.0", min_supported: "0.0.0" }));
  return {
    stderr,
    fetchImpl,
    deps: {
      env: {},
      isTty: true,
      now: new Date("2026-06-04T00:00:00.000Z"),
      baseUrl: "https://api.test",
      readCache: async () => null,
      writeCache: vi.fn(async () => {}),
      stderr,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...overrides,
    },
  };
}

const liveGlobal = { json: false, quiet: false };

describe("compareSemver", () => {
  it("orders triples and ignores v-prefix and prerelease suffixes", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3-rc.1", "1.2.3")).toBe(0);
    expect(compareSemver("0.0.0-dev", "0.0.0")).toBe(0);
    expect(compareSemver("0.0.0-dev", "0.1.0")).toBe(-1);
  });
});

describe("upgradeCommand", () => {
  it("maps each channel to its get-current command", () => {
    expect(upgradeCommand("binary")).toBe("agent-paste upgrade");
    expect(upgradeCommand("npm-global")).toBe("npm i -g @zaks-io/agent-paste@latest");
    expect(upgradeCommand("unknown")).toBe("npm i -g @zaks-io/agent-paste@latest");
    expect(upgradeCommand("npx")).toBeNull();
  });
});

describe("detectChannel", () => {
  it("classifies npx from the user agent or the _npx cache path", () => {
    expect(detectChannel({ npm_config_user_agent: "npm/10 npx/10" }, "/x", "/node")).toBe("npx");
    expect(detectChannel({}, "/home/u/.npm/_npx/abc/node_modules/.bin/agent-paste", "/node")).toBe("npx");
  });

  it("classifies npm-global from npm env or a node_modules path", () => {
    expect(detectChannel({ npm_config_user_agent: "npm/10" }, "/x", "/node")).toBe("npm-global");
    expect(detectChannel({}, "/usr/lib/node_modules/@zaks-io/agent-paste/dist/index.js", "/node")).toBe("npm-global");
  });

  it("classifies a bun-compiled binary as its own entrypoint", () => {
    expect(detectChannel({}, "/home/u/.local/bin/agent-paste", "/home/u/.local/bin/agent-paste")).toBe("binary");
  });

  it("does not call an extensionless Node-launched shim a binary", () => {
    // A global npm bin shim runs under Node, so execPath (node) never equals
    // argv1. Without a node_modules marker it is unknown, never binary.
    expect(detectChannel({}, "/usr/local/bin/agent-paste", "/usr/bin/node")).toBe("unknown");
  });
});

describe("runUpdateCheck", () => {
  it("prints the npm hint when a newer version exists on npm-global", async () => {
    const { stderr, deps } = liveDeps({ channel: "npm-global" });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith("Update available: 1.0.0. Run: npm i -g @zaks-io/agent-paste@latest\n");
  });

  it("prints the upgrade hint for a binary install", async () => {
    const { stderr, deps } = liveDeps({ channel: "binary" });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith("Update available: 1.0.0. Run: agent-paste upgrade\n");
  });

  it("suggests the npm command (not a dead upgrade) for an unknown channel", async () => {
    const { stderr, deps } = liveDeps({ channel: "unknown" });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith("Update available: 1.0.0. Run: npm i -g @zaks-io/agent-paste@latest\n");
  });

  it("stays silent on npx (it always runs the latest)", async () => {
    const { stderr, deps } = liveDeps({ channel: "npx" });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("warns when below min_supported, omitting the command on npx (always latest)", async () => {
    const { stderr, deps } = liveDeps({
      channel: "npx",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ latest: "1.0.0", min_supported: "5.0.0" }),
      ) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith(
      "Your agent-paste 0.0.0-dev is below the minimum supported 5.0.0. Upgrade soon.\n",
    );
  });

  it("appends the channel-correct command to the min_supported warning", async () => {
    const { stderr, deps } = liveDeps({
      channel: "npm-global",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ latest: "1.0.0", min_supported: "5.0.0" }),
      ) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith(
      "Your agent-paste 0.0.0-dev is below the minimum supported 5.0.0. Upgrade soon: npm i -g @zaks-io/agent-paste@latest\n",
    );
  });

  it("records the timestamp before fetching and the versions after success", async () => {
    const writeCache = vi.fn(async () => {});
    const { deps } = liveDeps({ channel: "binary", writeCache });
    await runUpdateCheck(liveGlobal, deps);
    // Stamped up front (throttle guarantee) then refreshed with the result.
    expect(writeCache).toHaveBeenNthCalledWith(1, { lastCheckAt: "2026-06-04T00:00:00.000Z" });
    expect(writeCache).toHaveBeenNthCalledWith(2, {
      lastCheckAt: "2026-06-04T00:00:00.000Z",
      latest: "1.0.0",
      min_supported: "0.0.0",
    });
  });

  it("still stamps the throttle when the fetch fails (so offline users are not re-checked)", async () => {
    const writeCache = vi.fn(async () => {});
    const { deps } = liveDeps({
      channel: "binary",
      writeCache,
      fetchImpl: vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, deps);
    expect(writeCache).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledWith({ lastCheckAt: "2026-06-04T00:00:00.000Z" });
  });

  for (const suppression of [
    { name: "AGENT_PASTE_NO_UPDATE_CHECK", patch: { env: { AGENT_PASTE_NO_UPDATE_CHECK: "1" } } },
    { name: "CI", patch: { env: { CI: "true" } } },
    { name: "non-TTY", patch: { isTty: false } },
  ]) {
    it(`makes no network call when suppressed by ${suppression.name}`, async () => {
      const { stderr, deps } = liveDeps({ channel: "binary", ...suppression.patch });
      const fetchImpl = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
      await runUpdateCheck(liveGlobal, deps);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    });
  }

  it("makes no network call when --json or --quiet is set", async () => {
    const { stderr, deps } = liveDeps({ channel: "binary" });
    const fetchImpl = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    await runUpdateCheck({ json: true, quiet: false }, deps);
    await runUpdateCheck({ json: false, quiet: true }, deps);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("skips the check while the cache is fresh (<24h)", async () => {
    const { stderr, deps } = liveDeps({
      channel: "binary",
      readCache: async () => ({ lastCheckAt: "2026-06-03T12:00:00.000Z" }),
    });
    const fetchImpl = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    await runUpdateCheck(liveGlobal, deps);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("checks again once the cache is stale (>24h)", async () => {
    const { stderr, deps } = liveDeps({
      channel: "binary",
      readCache: async () => ({ lastCheckAt: "2026-06-01T00:00:00.000Z" }),
    });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).toHaveBeenCalledWith("Update available: 1.0.0. Run: agent-paste upgrade\n");
  });

  it("swallows a rejected fetch without throwing or printing", async () => {
    const { stderr, deps } = liveDeps({
      channel: "binary",
      fetchImpl: vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    await expect(runUpdateCheck(liveGlobal, deps)).resolves.toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("swallows a non-200 response and a malformed body", async () => {
    const notOk = liveDeps({
      channel: "binary",
      fetchImpl: vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, notOk.deps);
    expect(notOk.stderr).not.toHaveBeenCalled();

    const garbage = liveDeps({
      channel: "binary",
      fetchImpl: vi.fn(async () => jsonResponse({ latest: 1 })) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, garbage.deps);
    expect(garbage.stderr).not.toHaveBeenCalled();
  });

  it("stays silent when already on the latest version", async () => {
    const { stderr, deps } = liveDeps({
      channel: "binary",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ latest: "0.0.0", min_supported: "0.0.0" }),
      ) as unknown as typeof fetch,
    });
    await runUpdateCheck(liveGlobal, deps);
    expect(stderr).not.toHaveBeenCalled();
  });
});
