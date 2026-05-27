import { type ArtifactId, LIVE_UPDATE_VIEWER_CAP, type RevisionId } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { ArtifactLiveHub } from "./live-hub.js";

const shareAuth = { kind: "access_link" as const, public_id: "0123456789ABCDEF", blob: "signed" };
const dashboardAuth = { kind: "dashboard" as const, authorization: "Bearer member" };

describe("ArtifactLiveHub", () => {
  it("refuses connections beyond the viewer cap", () => {
    const hub = new ArtifactLiveHub();
    for (let index = 0; index < LIVE_UPDATE_VIEWER_CAP; index += 1) {
      const result = hub.connect({
        id: `conn-${index}`,
        audience: "share",
        auth: shareAuth,
        send: vi.fn(),
        close: vi.fn(),
      });
      expect(result.ok).toBe(true);
    }
    const blocked = hub.connect({
      id: "conn-overflow",
      audience: "share",
      auth: shareAuth,
      send: vi.fn(),
      close: vi.fn(),
    });
    expect(blocked).toEqual({ ok: false, code: "live_update_at_cap" });
  });

  it("re-signs publish pointers per connection", async () => {
    const hub = new ArtifactLiveHub();
    const sendShare = vi.fn();
    const sendDashboard = vi.fn();
    hub.connect({ id: "share", audience: "share", auth: shareAuth, send: sendShare, close: vi.fn() });
    hub.connect({ id: "dash", audience: "dashboard", auth: dashboardAuth, send: sendDashboard, close: vi.fn() });
    const sharePointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as RevisionId,
      iframe_src: "https://content.test/v/share-token/index.html",
      render_mode: "html" as const,
      title: "Share",
    };
    const dashboardPointer = {
      ...sharePointer,
      iframe_src: "https://content.test/v/dashboard-token/index.html",
    };
    const revision = {
      revision_id: sharePointer.revision_id,
      entrypoint: "index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    await hub.publishRevision(revision, "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as ArtifactId, async (connection) =>
      connection.audience === "share" ? sharePointer : dashboardPointer,
    );
    expect(sendShare).toHaveBeenCalledWith(
      expect.objectContaining({ type: "published_revision", pointer: sharePointer }),
    );
    expect(sendDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ type: "published_revision", pointer: dashboardPointer }),
    );
  });

  it("revokes connections that fail re-sign on publish", async () => {
    const hub = new ArtifactLiveHub();
    const send = vi.fn();
    const close = vi.fn();
    hub.connect({ id: "share", audience: "share", auth: shareAuth, send, close });
    await hub.publishRevision(
      {
        revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        entrypoint: "index.html",
        render_mode: "html",
        title: "Demo",
      },
      "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as ArtifactId,
      async () => null,
    );
    expect(send).toHaveBeenCalledWith({ type: "revoked", reason: "access_link_lockdown" });
    expect(close).toHaveBeenCalled();
    expect(hub.connectionCount).toBe(0);
  });

  it("continues fan-out when one connection send throws", async () => {
    const hub = new ArtifactLiveHub();
    const sendOk = vi.fn();
    hub.connect({
      id: "broken",
      audience: "share",
      auth: shareAuth,
      send: () => {
        throw new Error("broken");
      },
      close: vi.fn(),
    });
    hub.connect({ id: "ok", audience: "share", auth: shareAuth, send: sendOk, close: vi.fn() });
    const pointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      iframe_src: "https://content.test/v/art.rev/index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    await hub.publishRevision(
      {
        revision_id: pointer.revision_id,
        entrypoint: "index.html",
        render_mode: "html",
        title: "Demo",
      },
      "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as ArtifactId,
      async () => pointer,
    );
    expect(sendOk).toHaveBeenCalled();
  });

  it("continues disconnect fan-out when one connection close throws", () => {
    const hub = new ArtifactLiveHub();
    const closeOk = vi.fn();
    hub.connect({
      id: "broken-close",
      audience: "share",
      auth: shareAuth,
      send: vi.fn(),
      close: () => {
        throw new Error("close failed");
      },
    });
    hub.connect({ id: "ok-close", audience: "share", auth: shareAuth, send: vi.fn(), close: closeOk });
    hub.disconnect(["share"], "deletion");
    expect(closeOk).toHaveBeenCalled();
    expect(hub.connectionCount).toBe(0);
  });

  it("disconnects only share connections on access link lockdown", () => {
    const hub = new ArtifactLiveHub();
    const closeShare = vi.fn();
    const closeDashboard = vi.fn();
    hub.connect({ id: "share", audience: "share", auth: shareAuth, send: vi.fn(), close: closeShare });
    hub.connect({ id: "dash", audience: "dashboard", auth: dashboardAuth, send: vi.fn(), close: closeDashboard });
    hub.disconnect(["share"], "access_link_lockdown");
    expect(closeShare).toHaveBeenCalled();
    expect(closeDashboard).not.toHaveBeenCalled();
    expect(hub.connectionCount).toBe(1);
  });
});
