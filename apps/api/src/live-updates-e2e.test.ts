import { LiveUpdatePublishedRevisionEvent, LiveUpdateRevokedEvent } from "@agent-paste/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactId,
  createLiveUpdatesE2eHarness,
  createSseCollector,
  initialRevisionId,
  resetMemoryArtifactLiveHubs,
  updatedRevisionId,
} from "./test-helpers/live-updates-e2e-harness.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(() => {
  resetMemoryArtifactLiveHubs();
});

describe("live updates publish-to-SSE end-to-end", () => {
  it("forwards API publish notifications to subscribed share-link SSE clients", async () => {
    const harness = createLiveUpdatesE2eHarness();
    const response = await harness.connectShareLiveUpdates();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const collector = createSseCollector(response);
    const [initial] = await collector.waitFor(1);
    expect(initial).toMatchObject({
      type: "published_revision",
      artifact_id: artifactId,
      pointer: {
        revision_id: initialRevisionId,
      },
    });

    harness.setCurrentRevisionId(updatedRevisionId);
    await harness.notifyPublish(updatedRevisionId);

    const events = await collector.waitFor(2);
    const publishEvent = events[1];
    expect(publishEvent.type).toBe("published_revision");
    const parsedPublish = LiveUpdatePublishedRevisionEvent.safeParse(publishEvent);
    expect(parsedPublish.success).toBe(true);
    expect(parsedPublish.data).toMatchObject({
      artifact_id: artifactId,
      pointer: {
        revision_id: updatedRevisionId,
        iframe_src: `https://content.test/v/${artifactId}.${updatedRevisionId}/index.html`,
        render_mode: "html",
        title: "Shared",
      },
    });

    await collector.close();
  });

  it("forwards API publish notifications to subscribed dashboard SSE clients", async () => {
    const harness = createLiveUpdatesE2eHarness();
    const response = await harness.connectDashboardLiveUpdates();
    expect(response.status).toBe(200);

    const collector = createSseCollector(response);
    await collector.waitFor(1);

    harness.setCurrentRevisionId(updatedRevisionId);
    await harness.notifyPublish(updatedRevisionId);

    const events = await collector.waitFor(2);
    expect(events[1]).toMatchObject({
      type: "published_revision",
      artifact_id: artifactId,
      pointer: {
        revision_id: updatedRevisionId,
      },
    });

    await collector.close();
  });

  it("disconnects share-link viewers when API sends access link lockdown", async () => {
    const harness = createLiveUpdatesE2eHarness();
    const shareResponse = await harness.connectShareLiveUpdates();
    const dashboardResponse = await harness.connectDashboardLiveUpdates();

    const shareCollector = createSseCollector(shareResponse);
    const dashboardCollector = createSseCollector(dashboardResponse);
    await shareCollector.waitFor(1);
    await dashboardCollector.waitFor(1);

    await harness.notifyDisconnect(["share"], "access_link_lockdown");

    const shareEvents = await shareCollector.waitFor(2);
    const shareRevoked = shareEvents[1];
    expect(shareRevoked.type).toBe("revoked");
    const parsedShareRevoked = LiveUpdateRevokedEvent.safeParse(shareRevoked);
    expect(parsedShareRevoked.success).toBe(true);
    expect(parsedShareRevoked.data?.reason).toBe("access_link_lockdown");

    await sleep(50);
    expect(dashboardCollector.events).toHaveLength(1);

    await shareCollector.close();
    await dashboardCollector.close();
  });

  it("disconnects dashboard viewers when API sends platform lockdown", async () => {
    const harness = createLiveUpdatesE2eHarness();
    const shareResponse = await harness.connectShareLiveUpdates();
    const dashboardResponse = await harness.connectDashboardLiveUpdates();

    const shareCollector = createSseCollector(shareResponse);
    const dashboardCollector = createSseCollector(dashboardResponse);
    await shareCollector.waitFor(1);
    await dashboardCollector.waitFor(1);

    await harness.notifyDisconnect(["dashboard"], "platform_lockdown");

    const dashboardEvents = await dashboardCollector.waitFor(2);
    const dashboardRevoked = dashboardEvents[1];
    expect(dashboardRevoked).toMatchObject({
      type: "revoked",
      reason: "platform_lockdown",
    });

    expect(shareCollector.events).toHaveLength(1);

    await shareCollector.close();
    await dashboardCollector.close();
  });

  it("fans out workspace lockdown disconnects across artifact live hubs", async () => {
    const harness = createLiveUpdatesE2eHarness({ includeSecondArtifact: true });
    const firstResponse = await harness.connectShareLiveUpdates();
    const firstCollector = createSseCollector(firstResponse);
    await firstCollector.waitFor(1);

    await harness.notifyWorkspaceDisconnect(["share", "dashboard"], "platform_lockdown");

    const disconnectEvents = await firstCollector.waitFor(2);
    const revoked = disconnectEvents[1];
    expect(revoked).toMatchObject({
      type: "revoked",
      reason: "platform_lockdown",
    });

    await firstCollector.close();
  });
});
