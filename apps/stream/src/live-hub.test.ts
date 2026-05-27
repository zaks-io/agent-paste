import { type ArtifactId, LIVE_UPDATE_VIEWER_CAP, type RevisionId } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { ArtifactLiveHub } from "./live-hub.js";

describe("ArtifactLiveHub", () => {
  it("refuses connections beyond the viewer cap", () => {
    const hub = new ArtifactLiveHub();
    for (let index = 0; index < LIVE_UPDATE_VIEWER_CAP; index += 1) {
      const result = hub.connect({
        id: `conn-${index}`,
        audience: "share",
        send: vi.fn(),
        close: vi.fn(),
      });
      expect(result.ok).toBe(true);
    }
    const blocked = hub.connect({
      id: "conn-overflow",
      audience: "share",
      send: vi.fn(),
      close: vi.fn(),
    });
    expect(blocked).toEqual({ ok: false, code: "live_update_at_cap" });
  });

  it("fans out publish pointers to every connection", () => {
    const hub = new ArtifactLiveHub();
    const sendShare = vi.fn();
    const sendDashboard = vi.fn();
    hub.connect({ id: "share", audience: "share", send: sendShare, close: vi.fn() });
    hub.connect({ id: "dash", audience: "dashboard", send: sendDashboard, close: vi.fn() });
    const pointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as RevisionId,
      iframe_src: "https://content.test/v/art.rev/index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    hub.publish(pointer, "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as ArtifactId);
    expect(sendShare).toHaveBeenCalledWith(expect.objectContaining({ type: "published_revision", pointer }));
    expect(sendDashboard).toHaveBeenCalledWith(expect.objectContaining({ type: "published_revision", pointer }));
  });

  it("continues fan-out when one connection send throws", () => {
    const hub = new ArtifactLiveHub();
    const sendOk = vi.fn();
    hub.connect({ id: "broken", audience: "share", send: () => { throw new Error("broken"); }, close: vi.fn() });
    hub.connect({ id: "ok", audience: "share", send: sendOk, close: vi.fn() });
    const pointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      iframe_src: "https://content.test/v/art.rev/index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    hub.publish(pointer, "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as import("@agent-paste/contracts").ArtifactId);
    expect(sendOk).toHaveBeenCalled();
  });

  it("disconnects only share connections on access link lockdown", () => {
    const hub = new ArtifactLiveHub();
    const closeShare = vi.fn();
    const closeDashboard = vi.fn();
    hub.connect({ id: "share", audience: "share", send: vi.fn(), close: closeShare });
    hub.connect({ id: "dash", audience: "dashboard", send: vi.fn(), close: closeDashboard });
    hub.disconnect(["share"], "access_link_lockdown");
    expect(closeShare).toHaveBeenCalled();
    expect(closeDashboard).not.toHaveBeenCalled();
    expect(hub.connectionCount).toBe(1);
  });
});
