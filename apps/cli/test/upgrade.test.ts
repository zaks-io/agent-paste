import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assetNameFor, parseSha256Sums, runUpgrade, UpgradePermissionError } from "../src/upgrade.js";

function bytesOf(values: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values) as Uint8Array<ArrayBuffer>;
}

function sha256(bytes: Uint8Array<ArrayBuffer>): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// This test file's own directory, derived from import.meta.url without node:url
// (the CLI keeps a minimal node shim and does not declare it). strips file://.
const testDir = path.dirname(import.meta.url.replace(/^file:\/\//, ""));

// A spying fs surface that records every write/rename so a test can assert the
// running binary was (or was not) touched, and inject failures on the swap.
function fakeFs(overrides: Record<string, unknown> = {}) {
  const calls = { writeFile: [] as string[], rename: [] as Array<[string, string]>, rm: [] as string[] };
  return {
    calls,
    ops: {
      stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, mode: 0o755 })),
      writeFile: vi.fn(async (p: string) => {
        calls.writeFile.push(p);
      }),
      chmod: vi.fn(async () => {}),
      rename: vi.fn(async (from: string, to: string) => {
        calls.rename.push([from, to]);
      }),
      rm: vi.fn(async (p: string) => {
        calls.rm.push(p);
      }),
      mkdir: vi.fn(async () => undefined),
      ...overrides,
    } as never,
  };
}

// Deps that drive a successful binary upgrade. The asset bytes hash into the
// SHA256SUMS so verification passes; individual tests override pieces.
function binaryDeps(overrides: Record<string, unknown> = {}) {
  const asset = "agent-paste-linux-x64";
  const bytes = bytesOf([1, 2, 3, 4]);
  const sums = `${sha256(bytes)}  ${asset}\n`;
  const stdout = vi.fn();
  const stderr = vi.fn();
  const fs = fakeFs();
  return {
    asset,
    bytes,
    stdout,
    stderr,
    fs,
    deps: {
      channel: "binary" as const,
      platform: "linux",
      arch: "x64",
      binaryPath: "/home/u/.local/bin/agent-paste",
      resolveLatest: vi.fn(async () => "1.2.3"),
      fetchBytes: vi.fn(async () => bytes),
      fetchText: vi.fn(async () => sums),
      fsOps: fs.ops,
      rand: () => "RND",
      // Inject the rescue stage so a permission wall never writes to the real
      // config dir; tests assert the returned path appears in the sudo hint.
      rescueStage: vi.fn(async () => "/home/u/.config/agent-paste/agent-paste-upgrade-RND"),
      stdout,
      stderr,
      ...overrides,
    },
  };
}

describe("assetNameFor", () => {
  it("maps each supported platform/arch to its asset", () => {
    expect(assetNameFor("darwin", "arm64")).toBe("agent-paste-darwin-arm64");
    expect(assetNameFor("linux", "x64")).toBe("agent-paste-linux-x64");
    expect(assetNameFor("linux", "arm64")).toBe("agent-paste-linux-arm64");
    expect(assetNameFor("win32", "x64")).toBe("agent-paste-windows-x64.exe");
    expect(assetNameFor("linux", "x86_64")).toBe("agent-paste-linux-x64");
  });

  it("throws for an unsupported platform/arch", () => {
    expect(() => assetNameFor("linux", "riscv64")).toThrow(/no prebuilt binary/);
    expect(() => assetNameFor("freebsd", "x64")).toThrow(/no prebuilt binary/);
  });
});

describe("installer asset parity", () => {
  // The OS/arch table is ported from the sh/PowerShell installers, which are
  // string constants we cannot import. Read them off disk and assert the asset
  // names match, so renaming one without the others fails here.
  const readInstaller = (name: string) => fs.readFile(path.join(testDir, "..", "..", "apex", "src", name), "utf8");

  it("keeps the BIN prefix and POSIX targets aligned with the asset table", async () => {
    const sh = await readInstaller("install-sh.ts");
    // install-sh.ts builds names as "${BIN}-${target}"; assert the prefix that
    // makes our `agent-paste-` asset prefix correct, plus every full asset name.
    expect(sh).toContain('BIN="agent-paste"');
    const posix: Array<[string, string]> = [
      ["darwin", "arm64"],
      ["linux", "x64"],
      ["linux", "arm64"],
    ];
    for (const [platform, arch] of posix) {
      const asset = assetNameFor(platform, arch);
      expect(asset).toBe(`agent-paste-${platform}-${arch}`);
      expect(sh).toContain(`${platform}-${arch}`);
    }
  });

  it("keeps the full Windows asset name present in install-ps1.ts", async () => {
    const ps1 = await readInstaller("install-ps1.ts");
    // install-ps1.ts builds "$Bin-windows-x64.exe" with $Bin = 'agent-paste'.
    expect(ps1).toContain("$Bin = 'agent-paste'");
    expect(ps1).toContain("windows-x64.exe");
    expect(assetNameFor("win32", "x64")).toBe("agent-paste-windows-x64.exe");
  });
});

describe("parseSha256Sums", () => {
  it("matches both text and binary SHA256SUMS line forms", () => {
    const hash = "a".repeat(64);
    expect(parseSha256Sums(`${hash}  agent-paste-linux-x64`, "agent-paste-linux-x64")).toBe(hash);
    expect(parseSha256Sums(`${hash} *agent-paste-linux-x64`, "agent-paste-linux-x64")).toBe(hash);
  });

  it("does not match a different file that shares a prefix", () => {
    const hash = "b".repeat(64);
    expect(parseSha256Sums(`${hash}  agent-paste-linux-x64-extra`, "agent-paste-linux-x64")).toBeNull();
  });

  it("returns null when the asset is absent", () => {
    expect(parseSha256Sums(`${"c".repeat(64)}  other-file`, "agent-paste-linux-x64")).toBeNull();
  });
});

describe("runUpgrade (binary channel)", () => {
  it("downloads, verifies, and atomically replaces the binary in its own dir", async () => {
    const { deps, fs, stdout } = binaryDeps();
    await runUpgrade({}, deps);

    // Staged write lands in the binary's own directory (no cross-device rename).
    expect(fs.calls.writeFile).toEqual(["/home/u/.local/bin/agent-paste.new-RND"]);
    // Rename-aside dance: current -> .old, then staged -> target.
    expect(fs.calls.rename).toEqual([
      ["/home/u/.local/bin/agent-paste", "/home/u/.local/bin/agent-paste.old-RND"],
      ["/home/u/.local/bin/agent-paste.new-RND", "/home/u/.local/bin/agent-paste"],
    ]);
    expect(fs.calls.rm).toContain("/home/u/.local/bin/agent-paste.old-RND");
    expect(stdout).toHaveBeenCalledWith("Upgraded agent-paste to cli-v1.2.3.\n");
  });

  it("resolves latest once and downloads the asset plus SHA256SUMS from the same release tag", async () => {
    const resolveLatest = vi.fn(async () => "3.4.5");
    const { deps, stdout } = binaryDeps({ resolveLatest });
    const fetchBytes = deps.fetchBytes as ReturnType<typeof vi.fn>;
    const fetchText = deps.fetchText as ReturnType<typeof vi.fn>;

    await runUpgrade({}, deps);

    expect(resolveLatest).toHaveBeenCalledTimes(1);
    expect(fetchBytes).toHaveBeenCalledWith(
      "https://github.com/zaks-io/agent-paste/releases/download/cli-v3.4.5/agent-paste-linux-x64",
    );
    expect(fetchText).toHaveBeenCalledWith(
      "https://github.com/zaks-io/agent-paste/releases/download/cli-v3.4.5/SHA256SUMS",
    );
    expect(stdout).toHaveBeenCalledWith("Downloading agent-paste-linux-x64 (cli-v3.4.5)...\n");
    expect(stdout).toHaveBeenCalledWith("Upgraded agent-paste to cli-v3.4.5.\n");
  });

  it("short-circuits without downloading when already at or ahead of latest", async () => {
    // CLI_VERSION is the build-time sentinel 0.0.0-dev (= 0.0.0) under test, so a
    // resolved latest of 0.0.0 is "already current": nothing should be fetched or
    // written, and it is a success (exit 0), not an error.
    const { deps, fs, stdout } = binaryDeps({ resolveLatest: vi.fn(async () => "0.0.0") });
    const fetchBytes = deps.fetchBytes as ReturnType<typeof vi.fn>;
    const fetchText = deps.fetchText as ReturnType<typeof vi.fn>;

    await runUpgrade({}, deps);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("already up to date"));
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(fetchText).not.toHaveBeenCalled();
    expect(fs.calls.writeFile).toEqual([]);
    expect(fs.calls.rename).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("still downloads a pinned --version even when it is at or below the installed version", async () => {
    // A pinned tag is a deliberate reinstall/downgrade request; the up-to-date
    // guard must not apply. cli-v0.0.0 is not newer than the 0.0.0-dev sentinel.
    const { deps } = binaryDeps();
    const fetchBytes = deps.fetchBytes as ReturnType<typeof vi.fn>;
    await runUpgrade({ version: "cli-v0.0.0" }, deps);
    expect(deps.resolveLatest).not.toHaveBeenCalled();
    expect(fetchBytes).toHaveBeenCalledWith(
      "https://github.com/zaks-io/agent-paste/releases/download/cli-v0.0.0/agent-paste-linux-x64",
    );
  });

  it("pins the release tag from an explicit version and never resolves latest", async () => {
    const { deps } = binaryDeps();
    const fetchBytes = deps.fetchBytes as ReturnType<typeof vi.fn>;
    await runUpgrade({ version: "cli-v0.2.0" }, deps);
    expect(deps.resolveLatest).not.toHaveBeenCalled();
    expect(fetchBytes).toHaveBeenCalledWith(
      "https://github.com/zaks-io/agent-paste/releases/download/cli-v0.2.0/agent-paste-linux-x64",
    );
  });

  it("rejects a path-traversal tag before any download (no verification bypass)", async () => {
    const { deps } = binaryDeps();
    const fetchBytes = deps.fetchBytes as ReturnType<typeof vi.fn>;
    // Would otherwise normalize to a different GitHub repo whose own SHA256SUMS
    // would "pass" — the validation must stop it before the fetch.
    await expect(runUpgrade({ version: "../../../attacker/evil/releases/download/v1" }, deps)).rejects.toThrow(
      /invalid release tag/,
    );
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("rejects a non-semver pinned tag", async () => {
    const { deps } = binaryDeps();
    await expect(runUpgrade({ version: "latest" }, deps)).rejects.toThrow(/invalid release tag/);
    await expect(runUpgrade({ version: "cli-v1.2" }, deps)).rejects.toThrow(/invalid release tag/);
  });

  it("refuses a tampered download and writes nothing", async () => {
    const { deps, fs } = binaryDeps({ fetchBytes: vi.fn(async () => bytesOf([9, 9, 9])) });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/checksum mismatch/);
    expect(fs.calls.writeFile).toEqual([]);
    expect(fs.calls.rename).toEqual([]);
  });

  it("refuses when the asset is missing from SHA256SUMS", async () => {
    const { deps, fs } = binaryDeps({ fetchText: vi.fn(async () => `${"d".repeat(64)}  some-other-file\n`) });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/no checksum/);
    expect(fs.calls.writeFile).toEqual([]);
  });

  it("surfaces an HTTP download error without writing", async () => {
    const { deps, fs } = binaryDeps({
      fetchBytes: vi.fn(async () => {
        throw new Error("download failed (HTTP 404): ...");
      }),
    });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/download failed/);
    expect(fs.calls.writeFile).toEqual([]);
  });

  it("stages the verified bytes in a writable rescue dir and prints a real sudo hint", async () => {
    const rescueStage = vi.fn(async () => "/home/u/.config/agent-paste/agent-paste-upgrade-RND");
    const fs = fakeFs({
      // The install dir is unwritable, so the in-dir stage itself fails.
      writeFile: vi.fn(async () => {
        const error = new Error("EACCES") as Error & { code: string };
        error.code = "EACCES";
        throw error;
      }),
    });
    const stderr = vi.fn();
    const { deps } = binaryDeps({ fsOps: fs.ops, stderr, rescueStage });
    await runUpgrade({}, deps);
    expect(process.exitCode).toBe(1);
    expect(rescueStage).toHaveBeenCalled();
    const message = stderr.mock.calls.map((c) => c[0]).join("");
    expect(message).toContain("not writable");
    // The hint must point at the rescue path (which exists), not the in-dir
    // stage (which could never be written).
    expect(message).toContain(
      "sudo mv /home/u/.config/agent-paste/agent-paste-upgrade-RND /home/u/.local/bin/agent-paste",
    );
    process.exitCode = 0;
  });

  it("reports plainly when even the rescue dir is unwritable", async () => {
    const fs = fakeFs({
      writeFile: vi.fn(async () => {
        const error = new Error("EACCES") as Error & { code: string };
        error.code = "EACCES";
        throw error;
      }),
    });
    const { deps } = binaryDeps({
      fsOps: fs.ops,
      rescueStage: vi.fn(async () => {
        throw new Error("config dir read-only");
      }),
    });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/could not stage the verified binary/);
  });

  it("cleans the staged binary and rethrows when rename-aside fails for a non-permission reason", async () => {
    const rescueStage = vi.fn(async () => "/home/u/.config/agent-paste/agent-paste-upgrade-RND");
    const fs = fakeFs({
      rename: vi.fn(async () => {
        const error = new Error("EXDEV: cross-device rename") as Error & { code: string };
        error.code = "EXDEV";
        throw error;
      }),
    });
    const { deps } = binaryDeps({ fsOps: fs.ops, rescueStage });

    await expect(runUpgrade({}, deps)).rejects.toThrow(/EXDEV/);

    expect(fs.calls.rm).toContain("/home/u/.local/bin/agent-paste.new-RND");
    expect(rescueStage).not.toHaveBeenCalled();
  });

  it("restores the original binary if the final rename fails", async () => {
    const renameCalls: Array<[string, string]> = [];
    const rmCalls: string[] = [];
    let calls = 0;
    const fs = fakeFs({
      rename: vi.fn(async (from: string, to: string) => {
        calls += 1;
        renameCalls.push([from, to]);
        if (calls === 2) throw new Error("ETXTBSY");
      }),
      rm: vi.fn(async (p: string) => {
        rmCalls.push(p);
      }),
    });
    const { deps } = binaryDeps({ fsOps: fs.ops });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/ETXTBSY/);
    // Third rename puts the original back from .old.
    expect(renameCalls[2]).toEqual(["/home/u/.local/bin/agent-paste.old-RND", "/home/u/.local/bin/agent-paste"]);
    // The orphaned staged file is cleaned up, not left in the install dir.
    expect(rmCalls).toContain("/home/u/.local/bin/agent-paste.new-RND");
  });

  it("rethrows a non-permission write error untranslated", async () => {
    const fs = fakeFs({
      writeFile: vi.fn(async () => {
        const error = new Error("ENOSPC: disk full") as Error & { code: string };
        error.code = "ENOSPC";
        throw error;
      }),
    });
    const { deps } = binaryDeps({ fsOps: fs.ops });
    await expect(runUpgrade({}, deps)).rejects.toThrow(/ENOSPC/);
  });

  it("treats a permission error on the rename-aside step as the permission wall", async () => {
    const stderr = vi.fn();
    const rescueStage = vi.fn(async () => "/home/u/.config/agent-paste/agent-paste-upgrade-RND");
    const fs = fakeFs({
      rename: vi.fn(async () => {
        const error = new Error("EPERM") as Error & { code: string };
        error.code = "EPERM";
        throw error;
      }),
    });
    const { deps } = binaryDeps({ fsOps: fs.ops, stderr, rescueStage });
    await runUpgrade({}, deps);
    expect(process.exitCode).toBe(1);
    // The half-written in-dir stage is removed; the verified bytes live in the
    // rescue dir that the sudo hint points at.
    expect(fs.calls.rm).toContain("/home/u/.local/bin/agent-paste.new-RND");
    expect(rescueStage).toHaveBeenCalled();
    expect(stderr.mock.calls.map((c) => c[0]).join("")).toContain(
      "sudo mv /home/u/.config/agent-paste/agent-paste-upgrade-RND /home/u/.local/bin/agent-paste",
    );
    process.exitCode = 0;
  });

  it("falls back to 0o755 when the binary's mode cannot be read", async () => {
    const chmod = vi.fn(async () => {});
    const fs = fakeFs({
      stat: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      chmod,
    });
    const { deps } = binaryDeps({ fsOps: fs.ops });
    await runUpgrade({}, deps);
    expect(chmod).toHaveBeenCalledWith("/home/u/.local/bin/agent-paste.new-RND", 0o755);
  });
});

describe("runUpgrade default fetch path", () => {
  // Exercise the real defaultResolveLatest/defaultFetchBytes/defaultFetchText by
  // injecting only fetchImpl, so the https guard and HTTP-status handling run.
  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return { ok, status, json: async () => body } as unknown as Response;
  }
  function bytesResponse(bytes: Uint8Array, ok = true, status = 200): Response {
    return { ok, status, arrayBuffer: async () => bytes.buffer } as unknown as Response;
  }
  function textResponse(text: string, ok = true, status = 200): Response {
    return { ok, status, text: async () => text } as unknown as Response;
  }

  function fetchDriven(routes: (url: string) => Response) {
    const fs = fakeFs();
    const fetchImpl = vi.fn(async (url: string) => routes(url));
    return {
      fs,
      fetchImpl,
      deps: {
        channel: "binary" as const,
        platform: "linux",
        arch: "x64",
        binaryPath: "/home/u/.local/bin/agent-paste",
        baseUrl: "https://api.test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        fsOps: fs.ops,
        rand: () => "RND",
        stdout: vi.fn(),
        stderr: vi.fn(),
      },
    };
  }

  it("resolves latest from the endpoint and verifies the real download", async () => {
    const bytes = bytesOf([7, 7, 7]);
    const sums = `${sha256(bytes)}  agent-paste-linux-x64\n`;
    const { deps, fetchImpl, fs } = fetchDriven((url) => {
      if (url.endsWith("/v1/public/cli-version")) return jsonResponse({ latest: "2.0.0", min_supported: "0.0.0" });
      if (url.endsWith("/SHA256SUMS")) return textResponse(sums);
      return bytesResponse(bytes);
    });
    await runUpgrade({}, deps);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.test/v1/public/cli-version", expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://github.com/zaks-io/agent-paste/releases/download/cli-v2.0.0/agent-paste-linux-x64",
      expect.anything(),
    );
    expect(fs.calls.rename.at(-1)).toEqual([
      "/home/u/.local/bin/agent-paste.new-RND",
      "/home/u/.local/bin/agent-paste",
    ]);
  });

  it("throws when the version endpoint is unreachable", async () => {
    const { deps } = fetchDriven((url) =>
      url.endsWith("/v1/public/cli-version") ? jsonResponse({}, false, 503) : textResponse(""),
    );
    await expect(runUpgrade({}, deps)).rejects.toThrow(/failed to resolve latest/);
  });

  it("throws on a non-2xx asset download", async () => {
    const { deps, fs } = fetchDriven((url) =>
      url.endsWith("/agent-paste-linux-x64") ? bytesResponse(new Uint8Array(), false, 404) : textResponse("x"),
    );
    await expect(runUpgrade({ version: "cli-v1.0.0" }, deps)).rejects.toThrow(/HTTP 404/);
    expect(fs.calls.writeFile).toEqual([]);
  });
});

describe("runUpgrade (non-binary channels)", () => {
  it("redirects npm-global to npm and never touches the filesystem", async () => {
    const stderr = vi.fn();
    const fs = fakeFs();
    const resolveLatest = vi.fn();
    const fetchBytes = vi.fn();
    await runUpgrade(
      {},
      { channel: "npm-global", stderr, fsOps: fs.ops as never, resolveLatest, fetchBytes: fetchBytes as never },
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("npm i -g @zaks-io/agent-paste@latest"));
    expect(process.exitCode).toBe(1);
    expect(resolveLatest).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(fs.calls.writeFile).toEqual([]);
    process.exitCode = 0;
  });

  it("tells npx users it always runs latest", async () => {
    const stderr = vi.fn();
    await runUpgrade({}, { channel: "npx", stderr });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("npx always runs the latest"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("UpgradePermissionError", () => {
  it("carries the staged and target paths", () => {
    const error = new UpgradePermissionError("nope", "/a/b.new", "/a/b");
    expect(error.stagedPath).toBe("/a/b.new");
    expect(error.targetPath).toBe("/a/b");
    expect(error.name).toBe("UpgradePermissionError");
  });
});
