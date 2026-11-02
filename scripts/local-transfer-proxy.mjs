// Local-only transport mapping. Preserve the capability hostname on the HTTP
// request so Content resolves its manifest and token on every revision.
import assert from "node:assert/strict";
import { request } from "node:http";
import { Readable } from "node:stream";

const target = process.env.AGENT_PASTE_LOCAL_CAPABILITY_PROXY;
if (target) {
  const base = new URL(target);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!url.hostname.endsWith(".transfers.test")) return original(input, init);
    assert.equal(url.protocol, "https:");
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    assert(["GET", "HEAD"].includes(method));
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => {
      headers.set(name, value);
    });
    headers.set("host", url.host);
    return new Promise((resolve, reject) => {
      const req = request(
        new URL(`${url.pathname}${url.search}`, base),
        {
          method,
          headers: Object.fromEntries(headers),
          signal: init?.signal,
        },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, values] of Object.entries(incoming.headers)) {
            for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values])
              responseHeaders.append(name, value);
          }
          const body = method === "HEAD" || [204, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
          if (!body) incoming.resume();
          resolve(new Response(body, { status: incoming.statusCode, headers: responseHeaders }));
        },
      );
      req.once("error", reject);
      req.end();
    });
  };
}
