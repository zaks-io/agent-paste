import { RepositoryError } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import {
  webApiKeys,
  webArtifactDetail,
  webArtifacts,
  webAudit,
  webAuthCallback,
  webCreateApiKey,
  webPinArtifact,
  webRevokeApiKey,
  webSettings,
  webUnpinArtifact,
  webUpdateSettings,
  webWorkspace,
} from "../src/routes/web.js";
import {
  contextFor,
  guardFor,
  memberActor,
  memberPrincipal,
  nonePrincipal,
  responseJson,
} from "./route-test-helpers.js";

describe("AP-91 web route modules", () => {
  it("provisions web callbacks only for WorkOS identities with stable callback ids", async () => {
    const notWorkos = await webAuthCallback(contextFor(), nonePrincipal(), {} as never);
    expect(notWorkos.status).toBe(401);

    const missingId = await webAuthCallback(contextFor(), memberPrincipal({ token_id: "" }), {} as never);
    expect(missingId.status).toBe(401);

    const resolveWebMember = vi.fn(async (input) => ({ member: { id: "mem_1" }, idempotency: input.idempotencyKey }));
    const resolved = await webAuthCallback(
      contextFor(),
      memberPrincipal({ token_id: undefined, session_id: "sess_1" }),
      { resolveWebMember } as never,
    );
    expect(resolved.status).toBe(200);
    expect(resolveWebMember).toHaveBeenCalledWith(
      expect.objectContaining({
        workosUserId: "user_1",
        email: "member@example.com",
        idempotencyKey: "workos-session:sess_1",
      }),
    );
  });

  it("serves web workspace, artifact, key, audit, and settings read surfaces for members only", async () => {
    const db = {
      getWebWorkspace: vi.fn(async () => ({ workspace: { id: "ws_1" } })),
      listWebArtifacts: vi.fn(async () => ({ items: [] })),
      listWebApiKeys: vi.fn(async () => ({ items: [] })),
      getWebSettings: vi.fn(async () => ({ workspace_name: "Agent Paste" })),
      listWebAuditEvents: vi.fn(async () => ({ items: [] })),
    };

    expect((await webWorkspace(contextFor(), nonePrincipal(), db as never)).status).toBe(403);
    expect((await webWorkspace(contextFor(), memberPrincipal(), db as never)).status).toBe(200);
    expect(
      (
        await webArtifacts(
          contextFor({ url: "https://api.test/v1/web/artifacts?limit=bad" }),
          memberPrincipal(),
          db as never,
        )
      ).status,
    ).toBe(400);
    expect((await webApiKeys(contextFor(), memberPrincipal(), db as never)).status).toBe(200);
    expect((await webSettings(contextFor(), memberPrincipal(), db as never)).status).toBe(200);

    const noAuditDb = await webAudit(contextFor(), memberPrincipal(), {} as never);
    expect(noAuditDb.status).toBe(503);

    db.listWebAuditEvents.mockRejectedValueOnce(new RepositoryError("invalid_cursor"));
    const badAuditCursor = await webAudit(contextFor(), memberPrincipal(), db as never);
    expect(badAuditCursor.status).toBe(400);
  });

  it("signs web artifact viewer URLs and returns not_found for missing artifacts", async () => {
    const missing = await webArtifactDetail(
      contextFor(),
      memberPrincipal(),
      { getWebArtifact: vi.fn(async () => null) } as never,
      { artifactId: "missing" },
    );
    expect(missing.status).toBe(404);

    const detail = await webArtifactDetail(
      contextFor({ env: { CONTENT_SIGNING_SECRET: "content-secret", CONTENT_BASE_URL: "https://content.test" } }),
      memberPrincipal(),
      {
        getWebArtifact: vi.fn(async () => ({
          id: "art_1",
          latest_revision_id: "rev_1",
          entrypoint: "index.html",
          viewer: { iframe_src: "https://old.test/v/art_1.rev_1/index.html" },
        })),
      } as never,
      { artifactId: "art_1" },
    );
    expect(detail.status).toBe(200);
    const body = await responseJson<{ viewer: { iframe_src: string } }>(detail);
    expect(body.viewer.iframe_src).toContain("https://content.test/v/");
    expect(body.viewer.iframe_src).toContain("/index.html");
  });

  it("maps web pin and unpin repository errors through route envelopes", async () => {
    const noPinDb = await webPinArtifact(contextFor(), memberPrincipal(), {} as never, guardFor(), {
      artifactId: "art_1",
    });
    expect(noPinDb.status).toBe(503);

    const pinWebArtifact = vi.fn(async () => {
      throw new RepositoryError("pinned_artifact_cap_exceeded");
    });
    const pinMapped = await webPinArtifact(contextFor(), memberPrincipal(), { pinWebArtifact } as never, guardFor(), {
      artifactId: "art_1",
    });
    expect(pinMapped.status).toBe(409);
    await expect(responseJson(pinMapped)).resolves.toMatchObject({ error: { code: "pinned_artifact_cap_exceeded" } });

    const unpinWebArtifact = vi.fn(async () => {
      throw new RepositoryError("artifact_not_found");
    });
    const unpinMapped = await webUnpinArtifact(
      contextFor(),
      memberPrincipal(),
      { unpinWebArtifact } as never,
      guardFor(),
      {
        artifactId: "art_1",
      },
    );
    expect(unpinMapped.status).toBe(404);
  });

  it("creates and revokes web API keys with CLI-specific expiry behavior", async () => {
    const createWebApiKey = vi.fn(async (input) => ({
      api_key: { name: input.name, expires: input.expiresInSeconds },
    }));
    const created = await webCreateApiKey(
      contextFor(),
      memberPrincipal({ auth_surface: "cli" }),
      { createWebApiKey } as never,
      guardFor({ name: "CLI key" }),
    );
    expect(created.status).toBe(201);
    expect(createWebApiKey).toHaveBeenCalledWith(expect.objectContaining({ expiresInSeconds: 7_776_000 }));

    const noCreateDb = await webCreateApiKey(
      contextFor(),
      memberPrincipal(),
      {} as never,
      guardFor({ name: "missing" }),
    );
    expect(noCreateDb.status).toBe(503);

    const revokeWebApiKey = vi.fn(async () => {
      throw new RepositoryError("not_found");
    });
    const missing = await webRevokeApiKey(contextFor(), memberPrincipal(), { revokeWebApiKey } as never, guardFor(), {
      apiKeyId: "key_missing",
    });
    expect(missing.status).toBe(404);
  });

  it("updates web settings for member actors and reports unavailable repositories", async () => {
    const updateWebSettings = vi.fn(async (input) => ({ workspace_name: input.workspaceName }));
    const updated = await webUpdateSettings(
      contextFor(),
      memberPrincipal(),
      { updateWebSettings } as never,
      guardFor({ workspace_name: "New name", auto_deletion_days: 30 }),
    );
    expect(updated.status).toBe(200);
    expect(updateWebSettings).toHaveBeenCalledWith(
      expect.objectContaining({ actor: memberActor, workspaceName: "New name", autoDeletionDays: 30 }),
    );

    const forbidden = await webUpdateSettings(
      contextFor(),
      nonePrincipal(),
      { updateWebSettings } as never,
      guardFor(),
    );
    expect(forbidden.status).toBe(403);

    const unavailable = await webUpdateSettings(contextFor(), memberPrincipal(), {} as never, guardFor());
    expect(unavailable.status).toBe(503);
  });
});
