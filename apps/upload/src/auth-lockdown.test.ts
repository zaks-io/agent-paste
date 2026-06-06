import { createLocalServices } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest } from "./index.js";

const adminActor = { type: "admin" as const, id: "operator" };
const platformActor = { type: "platform" as const, id: "operator@example.com" };

describe("upload auth under workspace Platform Lockdown", () => {
  it("returns generic not_authenticated for a locked workspace API key", async () => {
    const { repo, auth } = createLocalServices({ apiKeyPepper: "pepper" });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "upload-lockdown-workspace",
      email: "upload-lockdown@example.com",
    });
    const key = await repo.createApiKey({
      actor: adminActor,
      idempotencyKey: "upload-lockdown-key",
      workspaceId: workspace.id,
      name: "default",
    });
    await repo.setLockdown({
      actor: platformActor,
      idempotencyKey: "upload-lockdown-set",
      scope: "workspace",
      targetId: workspace.id,
      reasonCode: "abuse",
    });

    const createUploadSession = vi.fn(async () => ({ upload_session_id: "should-not-run" }));
    const env: Env = {
      AUTH: auth,
      UPLOAD_SIGNING_SECRET: "upload-secret",
      DB: { createUploadSession } as never,
    };
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.secret}`,
          "content-type": "application/json",
          "idempotency-key": "idem-upload",
        },
        body: JSON.stringify({
          title: "Demo",
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 1 }],
        }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "not_authenticated" } });
    expect(JSON.stringify(body)).not.toMatch(/lockdown|suspend/i);
    expect(createUploadSession).not.toHaveBeenCalled();
  });
});
