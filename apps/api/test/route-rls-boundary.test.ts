import type { ApiActor } from "@agent-paste/db";
import {
  createRouteBoundaryFixture,
  type RouteBoundaryFixture,
  type WorkspaceActorSeed,
} from "@agent-paste/db/test-helpers/route-boundary-fixture";
import type { Principal } from "@agent-paste/worker-runtime";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAccessLinkRoute, listAccessLinksRoute, revokeAccessLinkRoute } from "../src/routes/access-links.js";
import { billingStatus } from "../src/routes/billing.js";
import { authenticatedAgentView, listRevisions } from "../src/routes/revisions.js";
import { webArtifactDetail } from "../src/routes/web.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

function apiPrincipalFor(actor: ApiActor): Principal {
  return { kind: "api_key", actor } as Principal;
}

function memberPrincipalFor(seed: WorkspaceActorSeed): Principal {
  return {
    kind: "workos_access_token",
    actor: seed.memberActor,
    identity: { workos_user_id: seed.workosUserId, email: seed.memberActor.email },
  } as Principal;
}

function routeEnv(fixture: RouteBoundaryFixture) {
  return {
    CONTENT_SIGNING_SECRET: "content-secret",
    CONTENT_BASE_URL: "https://content.test",
    ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
    BILLING_ENABLED: "true",
    DB: fixture.executor,
  };
}

describe("AP-219 API PGlite route-boundary matrix", () => {
  let fixture: RouteBoundaryFixture;

  beforeAll(async () => {
    fixture = await createRouteBoundaryFixture();
  }, 180_000);

  describe("artifacts and revisions", () => {
    it("allows same-workspace revision listing and denies cross-workspace reads with artifact_not_found", async () => {
      const { workspaceA, workspaceB, repo } = fixture;
      const env = routeEnv(fixture);

      const allowed = await listRevisions(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${workspaceA.published.artifactId}/revisions`,
          params: { artifact_id: workspaceA.published.artifactId },
        }),
        apiPrincipalFor(workspaceA.apiActor),
        repo,
        { artifactId: workspaceA.published.artifactId },
      );
      expect(allowed.status).toBe(200);
      await expect(responseJson(allowed)).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ revision_id: workspaceA.published.revisionId, status: "published" }),
        ]),
      });

      const denied = await listRevisions(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${workspaceA.published.artifactId}/revisions`,
          params: { artifact_id: workspaceA.published.artifactId },
        }),
        apiPrincipalFor(workspaceB.apiActor),
        repo,
        { artifactId: workspaceA.published.artifactId },
      );
      expect(denied.status).toBe(404);
      await expect(responseJson(denied)).resolves.toMatchObject({ error: { code: "artifact_not_found" } });
    });

    it("allows same-workspace agent view and denies cross-workspace reads with not_found", async () => {
      const { workspaceA, workspaceB, repo } = fixture;
      const env = routeEnv(fixture);
      const params = {
        artifactId: workspaceA.published.artifactId,
        revisionId: workspaceA.published.revisionId,
      };

      const allowed = await authenticatedAgentView(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${params.artifactId}/revisions/${params.revisionId}/agent-view`,
          params,
        }),
        apiPrincipalFor(workspaceA.apiActor),
        repo,
        params,
      );
      expect(allowed.status).toBe(200);
      await expect(responseJson(allowed)).resolves.toMatchObject({
        artifact_id: workspaceA.published.artifactId,
        revision_id: workspaceA.published.revisionId,
      });

      const denied = await authenticatedAgentView(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${params.artifactId}/revisions/${params.revisionId}/agent-view`,
          params,
        }),
        apiPrincipalFor(workspaceB.apiActor),
        repo,
        params,
      );
      expect(denied.status).toBe(404);
      await expect(responseJson(denied)).resolves.toMatchObject({ error: { code: "not_found" } });
    });
  });

  describe("access links", () => {
    it("allows same-workspace link management and denies cross-workspace create, list, and revoke", async () => {
      const { workspaceA, workspaceB, repo } = fixture;
      const env = routeEnv(fixture);
      const denylist = { put: vi.fn(async () => {}) };

      const listed = await listAccessLinksRoute(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${workspaceA.published.artifactId}/access-links`,
          params: { artifact_id: workspaceA.published.artifactId },
        }),
        apiPrincipalFor(workspaceA.apiActor),
        repo,
      );
      expect(listed.status).toBe(200);
      await expect(responseJson(listed)).resolves.toMatchObject({
        items: expect.arrayContaining([expect.objectContaining({ id: workspaceA.accessLinkId })]),
      });

      const crossCreate = await createAccessLinkRoute(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${workspaceA.published.artifactId}/access-links`,
          params: { artifact_id: workspaceA.published.artifactId },
        }),
        apiPrincipalFor(workspaceB.apiActor),
        repo,
        guardFor({ type: "share" }, "idem-rls-link-create-deny"),
      );
      expect(crossCreate.status).toBe(404);
      await expect(responseJson(crossCreate)).resolves.toMatchObject({ error: { code: "artifact_not_found" } });

      const crossList = await listAccessLinksRoute(
        contextFor({
          env,
          url: `https://api.test/v1/artifacts/${workspaceA.published.artifactId}/access-links`,
          params: { artifact_id: workspaceA.published.artifactId },
        }),
        apiPrincipalFor(workspaceB.apiActor),
        repo,
      );
      expect(crossList.status).toBe(404);
      await expect(responseJson(crossList)).resolves.toMatchObject({ error: { code: "artifact_not_found" } });

      const revoked = await revokeAccessLinkRoute(
        contextFor({
          env: { ...env, DENYLIST: denylist },
          url: `https://api.test/v1/access-links/${workspaceA.accessLinkId}/revoke`,
          params: { access_link_id: workspaceA.accessLinkId },
        }),
        apiPrincipalFor(workspaceA.apiActor),
        repo,
      );
      expect(revoked.status).toBe(200);

      const crossRevoke = await revokeAccessLinkRoute(
        contextFor({
          env: { ...env, DENYLIST: denylist },
          url: `https://api.test/v1/access-links/${workspaceA.accessLinkId}/revoke`,
          params: { access_link_id: workspaceA.accessLinkId },
        }),
        apiPrincipalFor(workspaceB.apiActor),
        repo,
      );
      expect(crossRevoke.status).toBe(404);
      await expect(responseJson(crossRevoke)).resolves.toMatchObject({ error: { code: "not_found" } });
    });
  });

  describe("billing", () => {
    it("returns workspace-scoped billing status and never leaks another workspace plan", async () => {
      const { workspaceA, workspaceB } = fixture;
      const env = routeEnv(fixture);

      const statusA = await billingStatus(contextFor({ env }), memberPrincipalFor(workspaceA));
      expect(statusA.status).toBe(200);
      await expect(responseJson(statusA)).resolves.toMatchObject({
        plan: "pro",
        subscription: { status: "active", price_interval: "month" },
        daily_new_artifact_allowance: 2000,
      });

      const statusB = await billingStatus(contextFor({ env }), memberPrincipalFor(workspaceB));
      expect(statusB.status).toBe(200);
      await expect(responseJson(statusB)).resolves.toMatchObject({
        plan: "free",
        subscription: null,
        daily_new_artifact_allowance: 100,
      });
    });
  });

  describe("web dashboard", () => {
    it("allows same-workspace artifact detail and denies cross-workspace reads with not_found", async () => {
      const { workspaceA, workspaceB, repo } = fixture;
      const env = routeEnv(fixture);

      const allowed = await webArtifactDetail(
        contextFor({
          env,
          url: `https://api.test/v1/web/artifacts/${workspaceA.published.artifactId}`,
          params: { artifactId: workspaceA.published.artifactId },
        }),
        memberPrincipalFor(workspaceA),
        repo,
        { artifactId: workspaceA.published.artifactId },
      );
      expect(allowed.status).toBe(200);
      await expect(responseJson(allowed)).resolves.toMatchObject({
        id: workspaceA.published.artifactId,
        latest_revision_id: workspaceA.published.revisionId,
      });

      const denied = await webArtifactDetail(
        contextFor({
          env,
          url: `https://api.test/v1/web/artifacts/${workspaceA.published.artifactId}`,
          params: { artifactId: workspaceA.published.artifactId },
        }),
        memberPrincipalFor(workspaceB),
        repo,
        { artifactId: workspaceA.published.artifactId },
      );
      expect(denied.status).toBe(404);
      await expect(responseJson(denied)).resolves.toMatchObject({ error: { code: "not_found" } });
    });
  });
});
