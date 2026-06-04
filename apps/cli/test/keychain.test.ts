import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

import { execEntry } from "../src/keychain.js";

const SERVICE = "agent-paste";
const ACCOUNT = "default";

type SpawnReturn = { status: number | null; stdout?: string; stderr?: string; error?: Error };

function mockSpawn(...returns: SpawnReturn[]): void {
  for (const value of returns) {
    spawnSync.mockReturnValueOnce({
      status: value.status,
      stdout: value.stdout ?? "",
      stderr: value.stderr ?? "",
      error: value.error,
    });
  }
}

afterEach(() => {
  spawnSync.mockReset();
});

describe("execEntry platform selection", () => {
  it("returns null for Windows and other unsupported platforms", () => {
    expect(execEntry(SERVICE, ACCOUNT, "win32")).toBeNull();
    expect(execEntry(SERVICE, ACCOUNT, "freebsd")).toBeNull();
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

describe("macOS security entry", () => {
  function entry() {
    const value = execEntry(SERVICE, ACCOUNT, "darwin");
    if (!value) {
      throw new Error("expected a darwin entry");
    }
    return value;
  }

  it("reads a password and trims the trailing newline", () => {
    mockSpawn({ status: 0, stdout: "ap_pk_secret\n" });
    expect(entry().getPassword()).toBe("ap_pk_secret");
    expect(spawnSync).toHaveBeenCalledWith(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("returns null when the keychain item is absent (exit 44)", () => {
    mockSpawn({ status: 44, stderr: "could not be found" });
    expect(entry().getPassword()).toBeNull();
  });

  it("throws when security fails for any other reason", () => {
    mockSpawn({ status: 1, stderr: "User interaction is not allowed." });
    expect(() => entry().getPassword()).toThrow(/security failed/);
  });

  it("writes with -U so the item is updated in place", () => {
    mockSpawn({ status: 0 });
    entry().setPassword("ap_pk_secret");
    expect(spawnSync).toHaveBeenCalledWith(
      "security",
      ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", "ap_pk_secret"],
      expect.anything(),
    );
  });

  it("treats a missing item as a successful delete", () => {
    mockSpawn({ status: 44, stderr: "could not be found" });
    expect(() => entry().deletePassword()).not.toThrow();
  });

  it("propagates a spawn error (tool missing)", () => {
    mockSpawn({ status: null, error: new Error("spawn security ENOENT") });
    expect(() => entry().getPassword()).toThrow(/ENOENT/);
  });
});

describe("Linux secret-tool entry", () => {
  function entry() {
    const value = execEntry(SERVICE, ACCOUNT, "linux");
    if (!value) {
      throw new Error("expected a linux entry");
    }
    return value;
  }

  it("looks up a password by service and account attributes", () => {
    mockSpawn({ status: 0, stdout: "ap_pk_secret\n" });
    expect(entry().getPassword()).toBe("ap_pk_secret");
    expect(spawnSync).toHaveBeenCalledWith(
      "secret-tool",
      ["lookup", "service", SERVICE, "account", ACCOUNT],
      expect.anything(),
    );
  });

  it("returns null on a clean miss (non-zero exit, empty stderr)", () => {
    mockSpawn({ status: 1, stdout: "", stderr: "" });
    expect(entry().getPassword()).toBeNull();
  });

  it("throws when secret-tool reports a real failure", () => {
    mockSpawn({ status: 1, stderr: "Cannot create an item in a locked collection" });
    expect(() => entry().getPassword()).toThrow(/secret-tool failed/);
  });

  it("stores the secret over stdin, not argv", () => {
    mockSpawn({ status: 0 });
    entry().setPassword("ap_pk_secret");
    expect(spawnSync).toHaveBeenCalledWith(
      "secret-tool",
      ["store", "--label=agent-paste", "service", SERVICE, "account", ACCOUNT],
      expect.objectContaining({ input: "ap_pk_secret" }),
    );
  });

  it("clears the credential on delete", () => {
    mockSpawn({ status: 0 });
    entry().deletePassword();
    expect(spawnSync).toHaveBeenCalledWith(
      "secret-tool",
      ["clear", "service", SERVICE, "account", ACCOUNT],
      expect.anything(),
    );
  });
});
