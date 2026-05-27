import { LIVE_UPDATE_VIEWER_CAP } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { ArtifactLiveUpdates, liveUpdateAtCapResponse, sseResponseHeaders } from "./artifact-live.js";

const pointer = {
  revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  iframe_src: "https://content.test/v/art.rev/index.html",
  render_mode: "html" as const,
  title: "Demo",
};

function createDo() {
  return new ArtifactLiveUpdates({} as DurableObjectState, {
    API: { fetch: vi.fn() },
  });
}

describe("ArtifactLiveUpdates", () => {
  it("returns not_found for unknown routes", async () => {
    const doInstance = createDo();
    const response = await doInstance.fetch(new Request("https://do.test/unknown"));
    expect(response.status).toBe(404);
  });

  it("rejects invalid notify payloads and handles publish/disconnect ops", async () => {
    const doInstance = createDo();
    const malformed = await doInstance.fetch(
      new Request("https://do.test/internal/notify", { method: "POST", body: "not-json" }),
    );
    expect(malformed.status).toBe(400);

    const bad = await doInstance.fetch(new Request("https://do.test/internal/notify", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(400);

    const publish = await doInstance.fetch(
      new Request("https://do.test/internal/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "publish",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          pointer,
        }),
      }),
    );
    expect(publish.status).toBe(200);

    const disconnect = await doInstance.fetch(
      new Request("https://do.test/internal/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "disconnect",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audiences: ["share"],
          reason: "deletion",
        }),
      }),
    );
    expect(disconnect.status).toBe(200);
  });

  it("rejects invalid connect payloads and enforces the viewer cap", async () => {
    const doInstance = createDo();
    const invalid = await doInstance.fetch(
      new Request("https://do.test/sse/connect", { method: "POST", body: "null" }),
    );
    expect(invalid.status).toBe(400);

    const missingFields = await doInstance.fetch(
      new Request("https://do.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: "c1" }),
      }),
    );
    expect(missingFields.status).toBe(400);

    for (let index = 0; index < LIVE_UPDATE_VIEWER_CAP; index += 1) {
      const held = await doInstance.fetch(
        new Request("https://do.test/sse/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connection_id: `conn-${index}`,
            artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            audience: "share",
            pointer,
          }),
        }),
      );
      expect(held.status).toBe(200);
    }

    const capped = await doInstance.fetch(
      new Request("https://do.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: "overflow",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "dashboard",
          pointer,
        }),
      }),
    );
    expect(capped.status).toBe(503);
    await expect(capped.json()).resolves.toMatchObject({
      error: { code: "live_update_at_cap" },
    });
  });

  it("streams an initial published_revision event on connect", async () => {
    const doInstance = createDo();
    const response = await doInstance.fetch(
      new Request("https://do.test/sse/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: "conn-1",
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "share",
          pointer,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(sseResponseHeaders().get("content-type")).toContain("text/event-stream");
    expect(liveUpdateAtCapResponse().status).toBe(503);
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("published_revision");
    await reader?.cancel();
  });
});
