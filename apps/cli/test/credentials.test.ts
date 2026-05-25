import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Credential, fileStore } from "../src/credentials.js";

const credential: Credential = {
  api_key: "ap_pk_preview_secret",
  public_id: "0123456789ABCDEF",
  workspace_id: "ws_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  member_email: "user@example.com",
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

  it("returns null for a corrupt (non-JSON) credential file instead of throwing", async () => {
    const filePath = await tempPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "}{ not json");
    await expect(fileStore(filePath).load()).resolves.toBeNull();
  });
});
