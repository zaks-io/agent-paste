// Instrument output under backpressure, including injected bytes. Cancelling a
// response cancels the underlying stored-file reader without fetching more chunks.
export function measureStream(
  source: ReadableStream<Uint8Array>,
  onBytes: (n: number) => void,
  noindex = false,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let prefix = noindex ? new TextEncoder().encode('<meta name="robots" content="noindex,nofollow">') : null;
  return new ReadableStream(
    {
      async pull(controller) {
        try {
          if (prefix) {
            const bytes = prefix;
            prefix = null;
            controller.enqueue(bytes);
            onBytes(bytes.length);
            return;
          }
          const result = await reader.read();
          if (result.done) {
            controller.close();
            reader.releaseLock();
          } else {
            controller.enqueue(result.value);
            onBytes(result.value.length);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        reader.releaseLock();
      },
    },
    { highWaterMark: 0 },
  );
}
