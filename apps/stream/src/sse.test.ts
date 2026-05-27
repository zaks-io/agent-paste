import type { LiveUpdateSseEvent } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSseStream, formatSseEvent } from "./sse.js";

describe("sse helpers", () => {
  it("formats SSE frames with event name and JSON data", () => {
    const event: LiveUpdateSseEvent = {
      type: "revoked",
      reason: "deletion",
    };
    expect(formatSseEvent(event)).toBe('event: revoked\ndata: {"type":"revoked","reason":"deletion"}\n\n');
  });

  it("streams connect handlers and closes on cancel", async () => {
    const onClose = vi.fn();
    const onConnect = vi.fn((send: (event: LiveUpdateSseEvent) => void) => {
      send({ type: "revoked", reason: "takedown" });
    });
    const { stream } = createSseStream({ onConnect, onClose });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain("revoked");
    await reader.cancel();
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores duplicate close and send after the stream is closed", async () => {
    let sendRef: ((event: LiveUpdateSseEvent) => void) | undefined;
    const { stream } = createSseStream({
      onConnect(send) {
        sendRef = send;
        send({ type: "revoked", reason: "platform_lockdown" });
      },
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    sendRef?.({ type: "revoked", reason: "deletion" });
    const afterClose = await reader.read();
    expect(afterClose.done).toBe(true);
  });

  it("closes when onConnect throws and when abort fires", async () => {
    const onClose = vi.fn();
    const controller = new AbortController();
    const { stream: failing } = createSseStream({
      signal: controller.signal,
      onConnect: async () => {
        throw new Error("boom");
      },
      onClose,
    });
    const reader = failing.getReader();
    await reader.read();
    expect(onClose).toHaveBeenCalled();

    const onCloseAbort = vi.fn();
    const { stream: abortable } = createSseStream({
      signal: controller.signal,
      onConnect: () => {},
      onClose: onCloseAbort,
    });
    const abortReader = abortable.getReader();
    controller.abort();
    await abortReader.cancel();
    expect(onCloseAbort).toHaveBeenCalled();
  });

  it("still closes the controller when onClose throws", async () => {
    const { stream, close } = createSseStream({
      onConnect: () => {},
      onClose: () => {
        throw new Error("onClose failed");
      },
    });
    const reader = stream.getReader();
    close();
    const afterClose = await reader.read();
    expect(afterClose.done).toBe(true);
  });
});
