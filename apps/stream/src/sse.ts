import type { LiveUpdateSseEvent } from "@agent-paste/contracts";

export function formatSseEvent(event: LiveUpdateSseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createSseStream(handlers: {
  onConnect: (send: (event: LiveUpdateSseEvent) => void) => void | Promise<void>;
  onClose?: () => void;
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    handlers.onClose?.();
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const send = (event: LiveUpdateSseEvent) => {
    if (closed || !controllerRef) {
      return;
    }
    controllerRef.enqueue(encoder.encode(formatSseEvent(event)));
  };

  handlers.signal?.addEventListener("abort", close, { once: true });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      try {
        await handlers.onConnect(send);
      } catch {
        close();
      }
    },
    cancel() {
      close();
    },
  });
}
