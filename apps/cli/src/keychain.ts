import { spawnSync } from "node:child_process";

// Shell-backend OS keychain access. Instead of a native NAPI addon (which
// `bun build --compile` cannot embed because its binding is resolved through
// runtime, platform-branched require()s), we reach the OS keychain through the
// OS's own CLI tools. This keeps real keychain storage while leaving nothing to
// bundle, so the standalone binary is genuinely self-contained.
//
// The synchronous KeyringEntry contract matches what credentials.ts's
// keyringStore() already expects, so the store + its fallback/warning logic are
// untouched. A clean "not found" returns null; a present-but-failing tool
// throws so keyringStore() warns and falls back to the 0600 file.

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
};

// macOS `security` returns 44 (errSecItemNotFound) when the item is absent.
const SECURITY_NOT_FOUND = 44;

export function execEntry(service: string, account: string, platform: string = process.platform): KeyringEntry | null {
  if (platform === "darwin") {
    return securityEntry(service, account);
  }
  if (platform === "linux") {
    return secretToolEntry(service, account);
  }
  // Windows has no dependency-free CLI that can read a generic credential back
  // (cmdkey is write-only; PasswordVault is UWP-scoped), so fall through to the
  // file store. Other platforms are unsupported too.
  return null;
}

function securityEntry(service: string, account: string): KeyringEntry {
  const find = ["find-generic-password", "-s", service, "-a", account, "-w"];
  const remove = ["delete-generic-password", "-s", service, "-a", account];
  return {
    getPassword() {
      const result = run("security", find);
      if (result.status === SECURITY_NOT_FOUND) {
        return null;
      }
      return requireSuccess("security", result).stdout.replace(/\n$/, "");
    },
    setPassword(password) {
      // -U updates an existing item in place. The secret is passed via -w; macOS
      // does not offer a stdin form for add-generic-password.
      const result = run("security", ["add-generic-password", "-U", "-s", service, "-a", account, "-w", password]);
      requireSuccess("security", result);
    },
    deletePassword() {
      const result = run("security", remove);
      if (result.status === SECURITY_NOT_FOUND) {
        return;
      }
      requireSuccess("security", result);
    },
  };
}

function secretToolEntry(service: string, account: string): KeyringEntry {
  const attrs = ["service", service, "account", account];
  return {
    getPassword() {
      const result = run("secret-tool", ["lookup", ...attrs]);
      // A clean miss exits non-zero with empty output and no spawn error; a real
      // failure (missing tool, locked collection) sets error or writes stderr.
      if (result.status !== 0) {
        if (!result.error && !result.stderr.trim()) {
          return null;
        }
        throw spawnError("secret-tool", result);
      }
      const value = result.stdout.replace(/\n$/, "");
      return value === "" ? null : value;
    },
    setPassword(password) {
      // secret-tool reads the secret from stdin, keeping it out of argv.
      const result = run("secret-tool", ["store", "--label=agent-paste", ...attrs], password);
      requireSuccess("secret-tool", result);
    },
    deletePassword() {
      const result = run("secret-tool", ["clear", ...attrs]);
      requireSuccess("secret-tool", result);
    },
  };
}

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
};

function run(command: string, args: string[], stdin?: string): RunResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: stdin,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function requireSuccess(command: string, result: RunResult): RunResult {
  if (result.error || result.status !== 0) {
    throw spawnError(command, result);
  }
  return result;
}

function spawnError(command: string, result: RunResult): Error {
  if (result.error) {
    return result.error;
  }
  const detail = result.stderr.trim() || `exit ${result.status}`;
  return new Error(`${command} failed: ${detail}`);
}
