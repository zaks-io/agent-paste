export type ByteRange = { start: number; endInclusive: number };

export function requestedRange(request: Request, size: number, etag: string): ByteRange | "unsatisfiable" | null {
  if (request.method !== "GET") return null;
  const header = request.headers.get("range");
  if (!header) return null;
  const ifRange = request.headers.get("if-range");
  if (ifRange !== null && ifRange !== etag) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  // BigInt keeps valid decimal ranges exact even beyond Number.MAX_SAFE_INTEGER.
  const first = match[1] ? BigInt(match[1]) : null;
  const last = match[2] ? BigInt(match[2]) : null;
  if (size === 0) return "unsatisfiable";
  if (first === null) {
    if (last === 0n || last === null) return "unsatisfiable";
    return { start: last >= BigInt(size) ? 0 : size - Number(last), endInclusive: size - 1 };
  }
  if (first >= BigInt(size) || (last !== null && last < first)) return "unsatisfiable";
  return { start: Number(first), endInclusive: last === null || last >= BigInt(size) ? size - 1 : Number(last) };
}

export function applyRangeHeaders(headers: Headers, range: ByteRange | "unsatisfiable" | null, size: number): number {
  headers.set("accept-ranges", "bytes");
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    headers.set("content-length", "0");
    return 416;
  }
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.endInclusive}/${size}`);
    headers.set("content-length", String(range.endInclusive - range.start + 1));
    return 206;
  }
  return 200;
}
