import { LIVE_UPDATE_VIEWER_CAP } from "@agent-paste/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryArtifactLiveNamespace,
  formatSseEvent,
  resetMemoryArtifactLiveHubs,
} from "./memory-artifact-live.js";

const pointer = {
  revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  iframe_src: "https://content.test/v/art.rev/index.html",
  render_mode: "html" as const,
  title: "Demo",
};

const shareAuth = { kind: "access_link" as const, public_id: "0123456789ABCDEF", blob: "signed" };

describe("memory artifact live namespace", () => {
  afterEach(() => {
    resetMemoryArtifactLiveHubs();
  });

  it("re-exports SSE formatting for local harness consumers", () => {
    expect(formatSseEvent({ type: "revoked", reason: "deletion" })).toContain("event: revoked");
  });

  it("handles notify, connect, cap, and not_found paths", async () => {
    const api = {
      fetch: vi.fn(async () =>
        Response.json({
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "share",
          pointer,
        }),
      ),
    };
    const ns = createMemoryArtifactLiveNamespace({ api });
    const stub = ns.get("art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");

    const unknown = await stub.fetch(new Request("https://memory.test/missing"));
    expect(unknown.status).toBe(404);

    const badNotify = await stub.fetch(
      new Request("https://memory.test/internal/notify", { method: "POST", body: "{}" }),
    );
    expect(badNotify.status).toBe(400);

    const connected = await stub.fetch(
      new Request("https://memory.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: "mem-publish",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "share",
          pointer,
          auth: shareAuth,
        }),
      }),
    );
    expect(connected.status).toBe(200);

    await stub.fetch(
      new Request("https://memory.test/internal/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "publish",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revision: {
            revision_id: pointer.revision_id,
            entrypoint: "index.html",
            render_mode: pointer.render_mode,
            title: pointer.title,
          },
        }),
      }),
    );
    expect(api.fetch).toHaveBeenCalled();
    await connected.body?.cancel();

    await stub.fetch(
      new Request("https://memory.test/internal/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "disconnect",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audiences: ["dashboard"],
          reason: "platform_lockdown",
        }),
      }),
    );

    const badConnect = await stub.fetch(
      new Request("https://memory.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: "only" }),
      }),
    );
    expect(badConnect.status).toBe(400);

    for (let index = 0; index < LIVE_UPDATE_VIEWER_CAP; index += 1) {
      const response = await stub.fetch(
        new Request("https://memory.test/sse/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connection_id: `mem-${index}`,
            artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            audience: "share",
            pointer,
            auth: shareAuth,
          }),
        }),
      );
      expect(response.status).toBe(200);
    }

    const capped = await stub.fetch(
      new Request("https://memory.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: "mem-overflow",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "share",
          pointer,
          auth: shareAuth,
        }),
      }),
    );
    expect(capped.status).toBe(503);
  });
});
