import { contentTypeForPath, isCompressibleContentType } from "@agent-paste/storage";

/**
 * Decides gzip from the path's served type and the request's Accept-Encoding only,
 * never from body size, so the pre-R2 conditional check and the 200 pick the same
 * representation and therefore the same ETag.
 */
export function isGzipNegotiable(path: string): boolean {
  return isCompressibleContentType(contentTypeForPath(path));
}

export function negotiatesGzip(path: string, request: Request | undefined): boolean {
  return isGzipNegotiable(path) && acceptsGzip(request?.headers.get("accept-encoding") ?? null);
}

export function acceptsGzip(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) {
    return false;
  }
  let wildcardQuality: number | undefined;
  for (const member of acceptEncoding.split(",")) {
    const [coding = "", ...params] = member.split(";").map((part) => part.trim().toLowerCase());
    const quality = qualityValue(params);
    if (coding === "gzip" || coding === "x-gzip") {
      return quality > 0;
    }
    if (coding === "*") {
      wildcardQuality = quality;
    }
  }
  return wildcardQuality !== undefined && wildcardQuality > 0;
}

function qualityValue(params: string[]): number {
  const q = params.find((param) => param.startsWith("q="));
  if (!q) {
    return 1;
  }
  const value = Number(q.slice(2));
  return Number.isFinite(value) ? value : 0;
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}
