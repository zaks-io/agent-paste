// Bearer URLs stay out of shared caches; no-transform preserves uploaded bytes.
export const CONTENT_CACHE_CONTROL = "private, no-cache, no-transform";

export function contentCacheControl(input: {
  contentType: string;
  disposition: "inline" | "attachment";
  exp: number | null;
  nowSeconds: number;
}): string {
  const mime = input.contentType.split(";", 1)[0]?.trim();
  const staticAsset =
    mime !== undefined &&
    (/^(image|font|audio|video)\//.test(mime) || mime === "text/css" || mime === "application/javascript");
  if (input.disposition !== "inline" || !staticAsset) return CONTENT_CACHE_CONTROL;

  // Stable URLs can change or be revoked, so browser reuse has a bounded window.
  const maxAge = input.exp === null ? 3600 : Math.min(3600, input.exp - input.nowSeconds);
  if (maxAge <= 0) return CONTENT_CACHE_CONTROL;
  return `private, max-age=${maxAge}, must-revalidate, no-transform`;
}
