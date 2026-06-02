function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function nodeBufferCtor(): { from(input: Uint8Array): Uint8Array; isBuffer(value: unknown): boolean } | undefined {
  const ctor = (globalThis as { Buffer?: { from(input: Uint8Array): Uint8Array; isBuffer(value: unknown): boolean } })
    .Buffer;
  return ctor;
}

/** Encode application bytes for Postgres `bytea` parameters. */
export function byteaToDriver(value: Uint8Array): string | Uint8Array {
  const bufferCtor = nodeBufferCtor();
  if (bufferCtor) {
    return bufferCtor.from(value);
  }
  return `\\x${bytesToHex(value)}`;
}

/**
 * Decode `bytea` values from postgres-js / Drizzle. The driver returns Node `Buffer`
 * on read; some test harnesses may pass `Uint8Array` or `\x`-hex strings directly.
 */
export function byteaFromDriver(value: unknown): Uint8Array {
  const bufferCtor = nodeBufferCtor();
  if (bufferCtor?.isBuffer(value)) {
    return new Uint8Array(value as Uint8Array);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  throw new TypeError("bytea_from_driver_unsupported");
}
