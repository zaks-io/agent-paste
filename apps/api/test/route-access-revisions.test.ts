import { RepositoryError } from "@agent-paste/db";
import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { createMemoryWriteAllowanceNamespace, resetMemoryWriteAllowanceCounters } from "@agent-paste/write-allowance";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccessLinkRoute,
  listAccessLinksRoute,
  mintAccessLinkRoute,
  resolveAccessLinkRoute,
  revokeAccessLinkRoute,
} from "../src/routes/access-links.js";
import { authenticatedAgentView, listRevisions, publicAgentView, publishRevision } from "../src/routes/revisions.js";
import { apiPrincipal, contextFor, guardFor, nonePrincipal, responseJson, workspaceId } from "./route-test-helpers.js";

describe("AP-91 access link route modules", () => {
  it("creates member access links and maps repository not-found failures", async () => {
    const createMemberAccessLink = vi.fn(async () => ({ access_link_id: "al_1" }));
    const context = contextFor({ params: { artifact_id: "art_1" } });
    const response = await createAccessLinkRoute(
      context,
      apiPrincipal(),
      { createMemberAccessLink } as never,
      guardFor({ type: "share" }),
    );

    expect(response.status).toBe(201);
    expect(createMemberAccessLink).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "art_1", type: "share", revisionId: null }),
    );

    const denied = await createAccessLinkRoute(context, nonePrincipal(), {} as never, guardFor({ type: "share" }));
    expect(denied.status).toBe(401);

    createMemberAccessLink.mockRejectedValueOnce(new RepositoryError("artifact_not_found"));
    const missingArtifact = await createAccessLinkRoute(
      context,
      apiPrincipal(),
      { createMemberAccessLink } as never,
      guardFor(),
    );
    expect(missingArtifact.status).toBe(404);

    createMemberAccessLink.mockRejectedValueOnce(new RepositoryError("not_found"));
    const missingRevision = await createAccessLinkRoute(
      context,
      apiPrincipal(),
      { createMemberAccessLink } as never,
      guardFor(),
    );
    expect(missingRevision.status).toBe(404);
  });

  it("mints, lists, revokes, and resolves access links through route boundaries", async () => {
    const mintMemberAccessLink = vi.fn(async (input) => ({ access_link_url: `${input.appBaseUrl}/al/pub_1#blob` }));
    const listMemberAccessLinks = vi.fn(async () => null);
    const revokeMemberAccessLink = vi.fn(async () => ({ revoked_at: "2026-01-01T00:00:00.000Z" }));
    const db = { mintMemberAccessLink, listMemberAccessLinks, revokeMemberAccessLink };

    const noSigner = await mintAccessLinkRoute(contextFor(), apiPrincipal(), db as never);
    expect(noSigner.status).toBe(503);

    const minted = await mintAccessLinkRoute(
      contextFor({ env: { ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret" }, params: { access_link_id: "al_1" } }),
      apiPrincipal(),
      db as never,
    );
    expect(minted.status).toBe(200);
    expect(mintMemberAccessLink).toHaveBeenCalledWith(
      expect.objectContaining({ accessLinkId: "al_1", signingSecret: "access-link-secret" }),
    );

    mintMemberAccessLink.mockRejectedValueOnce(new RepositoryError("access_link_inactive_revoked"));
    const inactive = await mintAccessLinkRoute(
      contextFor({ env: { ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret" } }),
      apiPrincipal(),
      db as never,
    );
    expect(inactive.status).toBe(404);

    const listed = await listAccessLinksRoute(
      contextFor({ params: { artifact_id: "art_1" } }),
      apiPrincipal(),
      db as never,
    );
    expect(listed.status).toBe(404);

    revokeMemberAccessLink.mockRejectedValueOnce(new RepositoryError("not_found"));
    const revoked = await revokeAccessLinkRoute(
      contextFor({ params: { access_link_id: "missing" } }),
      apiPrincipal(),
      db as never,
    );
    expect(revoked.status).toBe(404);
  });

  it("resolves signed access links with iframe fallback and artifact rate limiting", async () => {
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 7,
      signingSecret: "access-link-secret",
    });
    const resolvedView = {
      access_link_id: "al_1",
      access_link_type: "share",
      workspace_id: workspaceId,
      render_mode: "html",
      title: "Shared",
      iframe_src: "https://content.test/original",
      agent_view: {
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Shared",
        files: [],
      },
    };
    const resolveAccessLink = vi.fn(async () => resolvedView);
    const baseContext = contextFor({
      env: { ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret" },
      body: { public_id: "0123456789ABCDEF", blob },
    });

    const ok = await resolveAccessLinkRoute(
      baseContext,
      { resolveAccessLink } as never,
      guardFor({ public_id: "0123456789ABCDEF", blob }),
    );
    expect(ok.status).toBe(200);
    await expect(responseJson(ok)).resolves.toMatchObject({ iframe_src: "https://content.test/original" });

    const limited = await resolveAccessLinkRoute(
      contextFor({
        env: {
          ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
          ARTIFACT_RATE_LIMIT: {
            async limit() {
              return { success: false };
            },
          },
        },
      }),
      { resolveAccessLink } as never,
      guardFor({ public_id: "0123456789ABCDEF", blob }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});

describe("AP-91 revision route modules", () => {
  beforeEach(() => {
    resetMemoryWriteAllowanceCounters();
  });

  it("returns retained revision errors for authenticated Agent View lookups", async () => {
    const getAgentView = vi.fn(async () => null);
    const listRevisionsFn = vi.fn(async () => ({
      items: [{ revision_id: "rev_1", status: "retained" }],
      next_cursor: null,
    }));
    const response = await authenticatedAgentView(
      contextFor(),
      apiPrincipal(),
      { getAgentView, listRevisions: listRevisionsFn } as never,
      { artifactId: "art_1", revisionId: "rev_1" },
    );

    expect(response.status).toBe(410);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "revision_retained" } });
  });

  it("lists revision not-found responses and renders public Agent View as HTML when requested", async () => {
    const missingList = await listRevisions(
      contextFor(),
      apiPrincipal(),
      { listRevisions: vi.fn(async () => null) } as never,
      {
        artifactId: "art_1",
      },
    );
    expect(missingList.status).toBe(404);

    const publicResponse = await publicAgentView(
      contextFor({ headers: { accept: "text/html" } }),
      { kind: "signed_agent_view_token", payload: { artifact_id: "art_1", revision_id: "rev_1" } } as never,
      {
        getPublicAgentView: vi.fn(async () => ({
          artifact_id: "art_1",
          revision_id: "rev_1",
          entrypoint: "index.html",
          files: [],
        })),
      } as never,
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("content-type")).toContain("text/html");
  });

  it("publishes revisions, maps repository errors, and keeps committed publishes when notifications fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const publishRevisionFn = vi.fn(async () => ({
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Published",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      bundle: { status: "pending" },
    }));
    const queue = {
      send: vi.fn(async () => {
        throw new Error("queue down");
      }),
    };
    const live = {
      idFromName: vi.fn(() => ({ id: "do" })),
      get: vi.fn(() => ({ fetch: vi.fn(async () => new Response("nope", { status: 500 })) })),
    };

    const published = await publishRevision(
      contextFor({ env: { BUNDLE_GENERATE_QUEUE: queue, ARTIFACT_LIVE: live as never } }),
      apiPrincipal(),
      { publishRevision: publishRevisionFn } as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(published.status).toBe(200);
    expect(warn).toHaveBeenCalled();

    publishRevisionFn.mockRejectedValueOnce(new RepositoryError("entrypoint_not_in_revision"));
    const mapped = await publishRevision(
      contextFor(),
      apiPrincipal(),
      { publishRevision: publishRevisionFn } as never,
      guardFor(),
      {
        artifactId: "art_1",
        revisionId: "rev_1",
      },
    );
    expect(mapped.status).toBe(422);
    await expect(responseJson(mapped)).resolves.toMatchObject({ error: { code: "entrypoint_not_in_revision" } });
    warn.mockRestore();
  });

  it("emits a publish analytics event once on a fresh publish but not on an idempotent replay", async () => {
    const publishRevisionFn = vi.fn(async () => ({
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Published",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      bundle: { status: "disabled" },
    }));
    const writeDataPoint = vi.fn();
    const artifactEvents = { writeDataPoint };

    const fresh = await publishRevision(
      contextFor({ env: { ARTIFACT_EVENTS: artifactEvents as never } }),
      apiPrincipal(),
      { peekWorkspaceCommandReplay: vi.fn(async () => null), publishRevision: publishRevisionFn } as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(fresh.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({ blobs: ["publish", "art_1", "rev_1", "standard"] }),
    );

    writeDataPoint.mockClear();
    const replay = await publishRevision(
      contextFor({ env: { ARTIFACT_EVENTS: artifactEvents as never } }),
      apiPrincipal(),
      {
        peekWorkspaceCommandReplay: vi.fn(async () => ({ result: { artifact_id: "art_1", revision_id: "rev_1" } })),
        publishRevision: publishRevisionFn,
      } as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(replay.status).toBe(200);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("returns write_allowance_exceeded with Retry-After for new artifacts over the daily allowance", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    const publishRevisionFn = vi.fn(async () => ({
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Published",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      bundle: { status: "disabled" },
    }));
    const db = {
      peekWorkspaceCommandReplay: vi.fn(async () => null),
      peekPublishWriteGate: vi.fn(async () => ({
        is_already_published: false,
        is_new_artifact: true,
        daily_new_artifact_allowance: 1,
      })),
      publishRevision: publishRevisionFn,
    };

    const allowed = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(allowed.status).toBe(200);

    const blocked = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor({}, "idem-fixture-second-artifact"),
      { artifactId: "art_2", revisionId: "rev_2" },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    await expect(responseJson(blocked)).resolves.toMatchObject({ error: { code: "write_allowance_exceeded" } });
    expect(publishRevisionFn).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 when a new artifact has no write-allowance binding", async () => {
    const publishRevisionFn = vi.fn(async () => ({
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Published",
      view_url: "https://content.test/v/art_1.rev_1/index.html",
      bundle: { status: "disabled" },
    }));
    const db = {
      peekWorkspaceCommandReplay: vi.fn(async () => null),
      peekPublishWriteGate: vi.fn(async () => ({
        is_already_published: false,
        is_new_artifact: true,
        daily_new_artifact_allowance: 1,
      })),
      publishRevision: publishRevisionFn,
    };

    const response = await publishRevision(contextFor({ env: {} }), apiPrincipal(), db as never, guardFor(), {
      artifactId: "art_1",
      revisionId: "rev_1",
    });

    expect(response.status).toBe(503);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "storage_unavailable" } });
    expect(publishRevisionFn).not.toHaveBeenCalled();
  });

  it("releases write allowance when publish fails so a fresh idempotency key can retry", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    const publishRevisionFn = vi
      .fn()
      .mockRejectedValueOnce(new RepositoryError("entrypoint_not_in_revision"))
      .mockResolvedValueOnce({
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Published",
        view_url: "https://content.test/v/art_1.rev_1/index.html",
        bundle: { status: "disabled" },
      });
    const db = {
      peekWorkspaceCommandReplay: vi.fn(async () => null),
      peekPublishWriteGate: vi.fn(async () => ({
        is_already_published: false,
        is_new_artifact: true,
        daily_new_artifact_allowance: 1,
      })),
      publishRevision: publishRevisionFn,
    };

    const failed = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor({}, "idem-fixture-failed-publish"),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(failed.status).toBe(422);
    await expect(responseJson(failed)).resolves.toMatchObject({ error: { code: "entrypoint_not_in_revision" } });

    const retry = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor({}, "idem-fixture-retry-publish"),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(retry.status).toBe(200);
    expect(publishRevisionFn).toHaveBeenCalledTimes(2);
  });

  it("returns idempotency_in_flight before consuming write allowance", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    const db = {
      peekWorkspaceCommandReplay: vi.fn(async () => ({ inFlight: true })),
      peekPublishWriteGate: vi.fn(async () => ({
        is_already_published: false,
        is_new_artifact: true,
        daily_new_artifact_allowance: 1,
      })),
      publishRevision: vi.fn(),
    };

    const response = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(response.status).toBe(409);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "idempotency_in_flight" } });
    expect(db.publishRevision).not.toHaveBeenCalled();
  });

  it("skips write allowance enforcement for idempotent replays and revision publishes", async () => {
    const writeAllowance = createMemoryWriteAllowanceNamespace();
    const db = {
      peekWorkspaceCommandReplay: vi.fn(async () => ({ result: { artifact_id: "art_1" } })),
      peekPublishWriteGate: vi.fn(async () => ({
        is_already_published: false,
        is_new_artifact: true,
        daily_new_artifact_allowance: 1,
      })),
      publishRevision: vi.fn(async () => ({
        artifact_id: "art_1",
        revision_id: "rev_1",
        title: "Published",
        view_url: "https://content.test/v/art_1.rev_1/index.html",
        bundle: { status: "disabled" },
      })),
    };

    const replay = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      db as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_1" },
    );
    expect(replay.status).toBe(200);

    const revisionPublish = await publishRevision(
      contextFor({ env: { WRITE_ALLOWANCE: writeAllowance } }),
      apiPrincipal(),
      {
        peekWorkspaceCommandReplay: vi.fn(async () => null),
        peekPublishWriteGate: vi.fn(async () => ({
          is_already_published: false,
          is_new_artifact: false,
          daily_new_artifact_allowance: 1,
        })),
        publishRevision: db.publishRevision,
      } as never,
      guardFor(),
      { artifactId: "art_1", revisionId: "rev_2" },
    );
    expect(revisionPublish.status).toBe(200);
  });
});
