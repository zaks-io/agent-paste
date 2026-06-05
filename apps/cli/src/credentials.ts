import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execEntry } from "./keychain.js";

export type Credential = {
  api_key: string;
  public_id: string;
  workspace_id: string;
  member_email: string;
  expires_at: string | null;
};

const SERVICE = "agent-paste";
const ACCOUNT = "default";

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
};

export type CredentialStore = {
  load(): Promise<Credential | null>;
  save(credential: Credential): Promise<void>;
  delete(): Promise<void>;
};

type WarningSink = (message: string) => void;

let warnedAboutFileFallback = false;

// Desktop platforms prefer the OS keychain via its own CLI tools. Unsupported
// platforms, missing tools, and headless Linux fall back to the existing 0600
// file so remote shells still work, but the warning makes the weaker storage
// explicit.
export function credentialStore(platform: string = process.platform): CredentialStore {
  const fallback = fileStore();
  const entry = execEntry(SERVICE, ACCOUNT, platform);
  return entry ? keyringStore(entry, fallback) : fallback;
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
      const dir = path.dirname(filePath);
      if (dir === configDir()) {
        await ensureConfigDir();
      } else {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      }
      await rejectSymlink(filePath);
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

export function keyringStore(
  entry: KeyringEntry,
  fallback: CredentialStore = fileStore(),
  warn: WarningSink = warnFileFallback,
): CredentialStore {
  return {
    async load() {
      try {
        const raw = entry.getPassword();
        return raw ? parseCredential(raw) : await fallback.load();
      } catch {
        return fallback.load();
      }
    },
    async save(credential) {
      try {
        entry.setPassword(JSON.stringify(credential));
      } catch {
        try {
          entry.deletePassword();
        } catch {
          // Best-effort: a stale keyring entry must not outrank the file fallback.
        }
        warn("agent-paste: OS keyring unavailable; storing credential in a 0600 file fallback.\n");
        await fallback.save(credential);
        return;
      }
      await fallback.delete();
    },
    async delete() {
      try {
        entry.deletePassword();
      } catch {
        // A missing or unavailable keyring is still a successful local cleanup.
      }
      await fallback.delete();
    },
  };
}

export function isCredentialExpired(credential: Credential, now: Date = new Date()): boolean {
  return credential.expires_at !== null && Date.parse(credential.expires_at) <= now.getTime();
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "agent-paste");
}

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
}

export function defaultCredentialPath(): string {
  return path.join(configDir(), "credentials.json");
}

export function updateCheckCachePath(): string {
  return path.join(configDir(), "update-check.json");
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
    typeof value.member_email === "string" &&
    (typeof value.expires_at === "string" || value.expires_at === null)
  ) {
    return {
      api_key: value.api_key,
      public_id: value.public_id,
      workspace_id: value.workspace_id,
      member_email: value.member_email,
      expires_at: value.expires_at,
    };
  }
  return null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

async function rejectSymlink(filePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write credential through symlink: ${filePath}`);
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

function warnFileFallback(message: string): void {
  if (!warnedAboutFileFallback) {
    process.stderr.write(message);
    warnedAboutFileFallback = true;
  }
}
