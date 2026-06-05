import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Credential, credentialStore, fileStore, isCredentialExpired, keyringStore } from "../src/credentials.js";

const credential: Credential = {
  api_key: "ap_pk_preview_secret",
  public_id: "0123456789ABCDEF",
  workspace_id: "ws_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  member_email: "user@example.com",
  expires_at: "2026-08-25T00:00:00.000Z",
};

async function tempPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cred-"));
  return path.join(dir, "nested", "credentials.json");
}

describe("file credential store", () => {
  it("returns null when no credential file exists", async () => {
    const store = fileStore(await tempPath());
    expect(await store.load()).toBeNull();
  });

  it("round-trips a credential and writes it 0600 under a 0700 dir", async () => {
    const filePath = await tempPath();
    const store = fileStore(filePath);
    await store.save(credential);

    expect(await store.load()).toEqual(credential);
    const fileStat = await fs.stat(filePath);
    const dirStat = await fs.stat(path.dirname(filePath));
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("refuses to overwrite a symlink credential path", async () => {
    const filePath = await tempPath();
    const targetPath = path.join(path.dirname(filePath), "target.json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(targetPath, "{}");
    await fs.symlink(targetPath, filePath);

    await expect(fileStore(filePath).save(credential)).rejects.toThrow(/symlink/);
  });

  it("deletes the credential and is idempotent on a missing file", async () => {
    const filePath = await tempPath();
    const store = fileStore(filePath);
    await store.save(credential);
    await store.delete();
    expect(await store.load()).toBeNull();
    await expect(store.delete()).resolves.toBeUndefined();
  });

  it("returns null for a malformed credential file", async () => {
    const filePath = await tempPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ api_key: "x" }));
    expect(await fileStore(filePath).load()).toBeNull();
  });

  it("returns null for old credentials without an expiry", async () => {
    const filePath = await tempPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        api_key: "ap_pk_preview_secret",
        public_id: "0123456789ABCDEF",
        workspace_id: "ws_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        member_email: "user@example.com",
      }),
    );
    expect(await fileStore(filePath).load()).toBeNull();
  });

  it("returns null for a corrupt (non-JSON) credential file instead of throwing", async () => {
    const filePath = await tempPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "}{ not json");
    await expect(fileStore(filePath).load()).resolves.toBeNull();
  });
});

describe("keyring credential store", () => {
  it("round-trips through the native keyring entry", async () => {
    const entry = memoryEntry();
    const store = keyringStore(entry, fileStore(await tempPath()));

    await store.save(credential);

    expect(await store.load()).toEqual(credential);
  });

  it("prefers file fallback over a stale keyring entry after setPassword fails", async () => {
    const staleCredential: Credential = {
      ...credential,
      api_key: "ap_pk_stale_keyring",
      member_email: "stale@example.com",
    };
    const freshCredential: Credential = {
      ...credential,
      api_key: "ap_pk_fresh_file",
      member_email: "fresh@example.com",
    };
    const entry = shadowingEntry(JSON.stringify(staleCredential));
    const filePath = await tempPath();
    const store = keyringStore(entry, fileStore(filePath), () => {});

    await store.save(freshCredential);

    expect(await fileStore(filePath).load()).toEqual(freshCredential);
    expect(await store.load()).toEqual(freshCredential);
  });

  it("falls back to file storage and warns when keyring save fails", async () => {
    const warnings: string[] = [];
    const filePath = await tempPath();
    const store = keyringStore(failingEntry(), fileStore(filePath), (message) => warnings.push(message));

    await store.save(credential);

    expect(warnings.join("")).toContain("OS keyring unavailable");
    expect(await fileStore(filePath).load()).toEqual(credential);
    expect(await store.load()).toEqual(credential);
  });

  it("deletes both keyring and file fallback credentials", async () => {
    const entry = memoryEntry();
    const filePath = await tempPath();
    const fallback = fileStore(filePath);
    const store = keyringStore(entry, fallback);

    await fallback.save(credential);
    await store.save(credential);
    expect(await fallback.load()).toBeNull();
    await store.delete();

    expect(await store.load()).toBeNull();
    expect(await fallback.load()).toBeNull();
  });
});

describe("credentialStore platform selection", () => {
  it("uses the bare file store on platforms without a keychain backend", async () => {
    // win32 has no shell-backend keychain, so credentialStore() must resolve to
    // a working file-backed store with no native module involved. Point
    // XDG_CONFIG_HOME at an empty temp dir to keep the default path hermetic.
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-cfg-"));
    try {
      const store = credentialStore("win32");
      await expect(store.load()).resolves.toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = previous;
      }
    }
  });
});

describe("credential expiry", () => {
  it("treats null expiry as durable and past timestamps as expired", () => {
    expect(isCredentialExpired({ ...credential, expires_at: null }, new Date("2026-08-25T00:00:00.000Z"))).toBe(false);
    expect(isCredentialExpired(credential, new Date("2026-08-24T23:59:59.999Z"))).toBe(false);
    expect(isCredentialExpired(credential, new Date("2026-08-25T00:00:00.000Z"))).toBe(true);
  });
});

function memoryEntry() {
  let value: string | null = null;
  return {
    getPassword: () => value,
    setPassword: (password: string) => {
      value = password;
    },
    deletePassword: () => {
      value = null;
    },
  };
}

function failingEntry() {
  return {
    getPassword: () => {
      throw new Error("missing keyring");
    },
    setPassword: () => {
      throw new Error("missing keyring");
    },
    deletePassword: () => {
      throw new Error("missing keyring");
    },
  };
}

function shadowingEntry(stalePassword: string) {
  let value: string | null = stalePassword;
  return {
    getPassword: () => value,
    setPassword: () => {
      throw new Error("keyring locked");
    },
    deletePassword: () => {
      value = null;
    },
  };
}
