import { RepositoryError } from "@agent-paste/db";
import { verifyContentToken } from "@agent-paste/tokens/content";
import { createMemoryWriteAllowanceNamespace, resetMemoryWriteAllowanceCounters } from "@agent-paste/write-allowance";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAgentView, listRevisions, publicAgentView, publishRevision } from "../src/routes/revisions.js";
import {
  apiPrincipal,
  contextFor,
  guardFor,
  memberPrincipal,
  responseJson,
  workspaceId,
} from "./route-test-helpers.js";

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
      contextFor({
        env: {
          ARTIFACT_RATE_LIMIT: {
            async limit() {
              return { success: true };
            },
          },
        },
        headers: { accept: "text/html" },
      }),
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

  it("keeps locked public Agent View generic and returns member lockdown metadata with scoped content tokens", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const lockedView = {
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      title: "Locked Demo",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
      entrypoint: "index.html",
      revision_content_url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
      files: [
        {
          path: "index.html",
          url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
          content_type: "text/html",
          size_bytes: 1,
        },
      ],
      safety_warnings: [],
      bundle: { status: "pending", retry_after_seconds: 5 },
      lockdown: {
        access_link: { locked: true, locked_at: "2026-02-01T00:00:00.000Z" },
        platform: {
          workspace: { locked: true, locked_at: "2026-02-02T00:00:00.000Z" },
          artifact: { locked: false, locked_at: null },
        },
      },
    };
    const db = {
      getAgentView: vi.fn(async () => lockedView),
      getPublicAgentView: vi.fn(async () => null),
    };

    const publicResponse = await publicAgentView(
      contextFor(),
      { kind: "signed_agent_view_token", payload: { artifact_id: artifactId, revision_id: revisionId } } as never,
      db as never,
    );
    expect(publicResponse.status).toBe(404);
    const publicBody = await responseJson(publicResponse);
    expect(publicBody).toMatchObject({ error: { code: "not_found" } });
    expect(JSON.stringify(publicBody)).not.toContain("Locked Demo");

    const authenticated = await authenticatedAgentView(
      contextFor({
        env: { CONTENT_SIGNING_SECRET: "content-secret", CONTENT_BASE_URL: "https://content.test" },
        params: { artifactId },
      }),
      memberPrincipal(),
      db as never,
      { artifactId },
    );
    expect(authenticated.status).toBe(200);
    const body = (await authenticated.json()) as {
      workspace_id?: string;
      revision_content_url: string;
      lockdown?: unknown;
    };
    expect(body.workspace_id).toBeUndefined();
    expect(body.lockdown).toEqual(lockedView.lockdown);

    const token = decodeURIComponent(body.revision_content_url.split("/v/")[1]?.split("/")[0] ?? "");
    const payload = await verifyContentToken(token, "content-secret");
    expect(payload).toMatchObject({
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
    });
  });

  it("publishes revisions, maps repository errors, and keeps committed publishes when queue delivery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const publishRevisionFn = vi.fn(async () => ({
      artifact_id: "art_1",
      revision_id: "rev_1",
      title: "Published",
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
      bundle: { status: "pending" },
    }));
    const queue = {
      send: vi.fn(async () => {
        throw new Error("queue down");
      }),
    };
    const published = await publishRevision(
      contextFor({ env: { BUNDLE_GENERATE_QUEUE: queue } }),
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
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
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
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
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
      revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
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
        revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
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
        revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
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
