// @ts-check

/**
 * Local Cloudflare fixtures use HTTP on loopback, never a hosted service.
 * Reject remote targets and redirects before a fixture credential can leave it.
 * @param {string | URL} input
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function localCloudflareRequest(input, options = {}) {
  const url = new URL(input);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new Error("Local Cloudflare requests require HTTP on 127.0.0.1 without URL credentials.");
  }
  if (options.redirect && options.redirect !== "manual" && options.redirect !== "error") {
    throw new Error("Local Cloudflare requests cannot follow redirects.");
  }
  return fetch(url, { ...options, redirect: options.redirect ?? "error" });
}
