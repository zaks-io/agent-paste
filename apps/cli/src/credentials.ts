import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify<{ stdout: string; stderr: string }>(execFile);

export type Credential = {
  api_key: string;
  public_id: string;
  workspace_id: string;
  member_email: string;
};

const SERVICE = "agent-paste";
const ACCOUNT = "default";

export type CredentialStore = {
  load(): Promise<Credential | null>;
  save(credential: Credential): Promise<void>;
  delete(): Promise<void>;
};

// macOS keeps the key in the login keychain; every other platform uses a
// 0600 file under XDG config. The backend is selected once at module load so
// tests can force the file path by stubbing process.platform.
export function credentialStore(platform: string = process.platform): CredentialStore {
  return platform === "darwin" ? keychainStore() : fileStore();
}

export function loadCredential(): Promise<Credential | null> {
  return credentialStore().load();
}

export function deleteCredential(): Promise<void> {
  return credentialStore().delete();
}

export function fileStore(filePath = defaultCredentialPath()): CredentialStore {
  return {
    async load() {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return parseCredential(raw);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async save(credential) {
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await fs.writeFile(filePath, JSON.stringify(credential), { mode: 0o600 });
      // writeFile's mode only applies when creating the file; an overwrite of a
      // pre-existing, looser-permission file keeps its old mode, so re-assert it.
      await fs.chmod(filePath, 0o600);
    },
    async delete() {
      try {
        await fs.rm(filePath);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    },
  };
}

function keychainStore(): CredentialStore {
  return {
    async load() {
      try {
        const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
        return parseCredential(stdout.trim());
      } catch {
        return null;
      }
    },
    async save(credential) {
      await run("security", [
        "add-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
        JSON.stringify(credential),
        "-U",
      ]);
    },
    async delete() {
      try {
        await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
      } catch {
        // Nothing stored; treat as already deleted.
      }
    },
  };
}

export function defaultCredentialPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "agent-paste", "credentials.json");
}

function parseCredential(raw: string): Credential | null {
  let value: Partial<Credential>;
  try {
    value = JSON.parse(raw) as Partial<Credential>;
  } catch {
    // A corrupt store is equivalent to no credential; the caller re-runs login.
    return null;
  }
  if (
    typeof value.api_key === "string" &&
    typeof value.public_id === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.member_email === "string"
  ) {
    return {
      api_key: value.api_key,
      public_id: value.public_id,
      workspace_id: value.workspace_id,
      member_email: value.member_email,
    };
  }
  return null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
