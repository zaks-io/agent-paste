import { afterEach, describe, expect, it, vi } from "vitest";
import { connectLiveUpdates } from "../src/lib/live-updates.js";

const pointer = {
  revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  iframe_src: "https://content.test/v/art.rev/index.html",
  render_mode: "html" as const,
  title: "Demo",
};

function sseResponse(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("connectLiveUpdates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes onUnavailable when the stream request fails", async () => {
    const onUnavailable = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    connectLiveUpdates({ url: "https://stream.test/live", onPointer: vi.fn(), onUnavailable });
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  });

  it("delivers published_revision pointers and revoked callbacks", async () => {
    const onPointer = vi.fn();
    const onRevoked = vi.fn();
    const published = `event: published_revision\ndata: ${JSON.stringify({
      type: "published_revision",
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      pointer,
    })}\n\n`;
    const revoked = `event: revoked\ndata: ${JSON.stringify({
      type: "revoked",
      reason: "access_link_lockdown",
    })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(published, revoked)),
    );
    connectLiveUpdates({ url: "https://stream.test/live", onPointer, onRevoked });
    await vi.waitFor(() => expect(onPointer).toHaveBeenCalledWith(pointer));
    await vi.waitFor(() => expect(onRevoked).toHaveBeenCalled());
  });

  it("sends POST bodies, ignores abort errors, and closes via AbortController", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ blob: "signed" }));
      return sseResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const connection = connectLiveUpdates({
      url: "https://stream.test/live",
      method: "POST",
      body: JSON.stringify({ blob: "signed" }),
      onPointer: vi.fn(),
    });
    connection.close();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("ignores malformed SSE chunks and mismatched event names", async () => {
    const onPointer = vi.fn();
    const garbage = "event: published_revision\ndata: not-json\n\n";
    const mismatch = `event: published_revision\ndata: ${JSON.stringify({
      type: "revoked",
      reason: "deletion",
    })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(garbage, mismatch)),
    );
    connectLiveUpdates({ url: "https://stream.test/live", onPointer });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onPointer).not.toHaveBeenCalled();
  });

  it("treats non-abort fetch errors as unavailable", async () => {
    const onUnavailable = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    connectLiveUpdates({ url: "https://stream.test/live", onPointer: vi.fn(), onUnavailable });
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  });

  it("swallows AbortError from external abort signals", async () => {
    const onUnavailable = vi.fn();
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    connectLiveUpdates({
      url: "https://stream.test/live",
      signal: controller.signal,
      onPointer: vi.fn(),
      onUnavailable,
    });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
