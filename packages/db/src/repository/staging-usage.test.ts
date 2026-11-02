import { REVISION_FILE_ENTRY_BYTES } from "@agent-paste/config";
import { afterEach, describe, expect, it } from "vitest";
import { type HostingFixture, hostingFixture, key } from "../test-helpers/persistent-hosting.js";
import { workspaceExecutor } from "../test-helpers/pglite.js";

for (const adapter of ["local", "database"] as const)
  describe(`legacy staging quota (${adapter})`, () => {
    let f: HostingFixture;
    afterEach(async () => f?.close());
    const request = { files: [{ path: "index.html", size_bytes: 10 }] };
    const uploaded = async () => {
      const s = await f.create(request);
      await f.repo.recordUploadedFile({
        workspaceId: f.ws.id,
        sessionId: s.session_id,
        path: "index.html",
        objectKey: s.files[0]?.object_key,
        sizeBytes: 10,
        uploadedAt: f.now(),
      });
      return s;
    };

    it("keeps SHA-less PUT bytes reserved through expiration and rejects another session", async () => {
      f = await hostingFixture(adapter);
      await f.setBudget(15);
      const s = await uploaded();
      expect(await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).toMatchObject({
        used_bytes: 0,
        reserved_bytes: 10,
      });
      await expect(f.create(request)).rejects.toMatchObject({ kind: "storage_quota_exceeded" });
      const future = new Date(Date.now() + 86400_000).toISOString();
      expect(await f.repo.getStorageUsage({ actor: f.actor, now: future })).toMatchObject({ reserved_bytes: 10 });
      if (f.local) {
        const row = f.local.uploadSessions.get(s.session_id);
        if (!row) throw new Error("missing session");
        row.status = "expired";
      } else if (f.sql) {
        await workspaceExecutor(f.sql, f.ws.id).query("update upload_sessions set status='expired' where id=$1", [
          s.session_id,
        ]);
      }
      expect(await f.repo.getStorageUsage({ actor: f.actor, now: future })).toMatchObject({ reserved_bytes: 10 });
    }, 60_000);

    it("transfers staging accounting into the draft without counting bytes twice", async () => {
      f = await hostingFixture(adapter);
      const s = await uploaded();
      await f.repo.finalizeUploadSession({
        actor: f.actor,
        idempotencyKey: key(),
        sessionId: s.session_id,
        now: f.now(),
        observedFiles: [{ path: "index.html", objectKey: s.files[0]?.object_key as string, sizeBytes: 10 }],
      });
      expect(await f.repo.getStorageUsage({ actor: f.actor, now: f.now() })).toMatchObject({
        used_bytes: 10 + REVISION_FILE_ENTRY_BYTES,
        reserved_bytes: 0,
        breakdown: { legacy_file_bytes: 10, blob_bytes: 0 },
      });
    }, 60_000);
  });
