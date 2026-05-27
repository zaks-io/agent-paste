import type { LiveUpdatePointer, LiveUpdateSseEvent } from "@agent-paste/contracts";

export type LiveUpdateConnection = {
  close: () => void;
};

export function connectLiveUpdates(input: {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  signal?: AbortSignal;
  onPointer: (pointer: LiveUpdatePointer) => void;
  onRevoked?: () => void;
  onUnavailable?: () => void;
}): LiveUpdateConnection {
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;

  void (async () => {
    try {
      const init: RequestInit = {
        method: input.method ?? "GET",
        headers: input.body
          ? { "content-type": "application/json", accept: "text/event-stream" }
          : { accept: "text/event-stream" },
        signal,
      };
      if (input.body) {
        init.body = input.body;
      }
      const response = await fetch(input.url, init);
      if (!response.ok || !response.body) {
        input.onUnavailable?.();
        return;
      }
      await readSseStream(response.body, {
        onEvent: (event) => {
          if (event.type === "published_revision") {
            input.onPointer(event.pointer);
            return;
          }
          if (event.type === "revoked") {
            input.onRevoked?.();
          }
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      input.onUnavailable?.();
    }
  })();

  return {
    close: () => controller.abort(),
  };
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: { onEvent: (event: LiveUpdateSseEvent) => void },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = parseSseChunk(chunk);
        if (event) {
          handlers.onEvent(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseChunk(chunk: string): LiveUpdateSseEvent | null {
  const lines = chunk.split("\n");
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLine = line.slice("data:".length).trim();
    }
  }
  if (!eventName || !dataLine) {
    return null;
  }
  try {
    const parsed = JSON.parse(dataLine) as LiveUpdateSseEvent;
    if (parsed.type === eventName) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
