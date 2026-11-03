// @ts-check
import assert from "node:assert/strict";

function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("An explicit transfer endpoint is required");
  }
  assert(
    !url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
    "Expected a bare transfer origin",
  );
  return url;
}

function worker(url, role) {
  assert(url.protocol === "https:" && !url.port, "Hosted transfers require HTTPS on the default port");
  const match = url.hostname.match(
    new RegExp(`^agent-paste-${role}-(pr-[1-9][0-9]*|preview)\\.([a-z0-9]+(?:-[a-z0-9]+)*)\\.workers\\.dev$`),
  );
  assert(match, "Expected a recognized non-production Worker host");
  return { scope: match[1], account: match[2] };
}

export function transferEndpoints(api, upload) {
  const apiUrl = endpoint(api);
  const uploadUrl = endpoint(upload);
  const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (local(apiUrl) && local(uploadUrl)) {
    assert(
      [apiUrl, uploadUrl].every((url) => ["http:", "https:"].includes(url.protocol)),
      "Expected HTTP endpoints",
    );
    return { api: apiUrl.origin, upload: uploadUrl.origin };
  }
  const a = worker(apiUrl, "api");
  const b = worker(uploadUrl, "upload");
  assert(a.scope === b.scope && a.account === b.account, "API and Upload must belong to the same preview and account");
  return { api: apiUrl.origin, upload: uploadUrl.origin };
}

export function hostedTransferEndpoints(env) {
  const pr = env.PR_NUMBER;
  assert(typeof pr === "string" && /^[1-9][0-9]*$/.test(pr), "A valid PR_NUMBER is required");
  const endpoints = transferEndpoints(env.AGENT_PASTE_PR_API_URL, env.AGENT_PASTE_PR_UPLOAD_URL);
  const api = worker(new URL(endpoints.api), "api");
  const content = endpoint(env.AGENT_PASTE_PR_CONTENT_URL);
  const c = worker(content, "content");
  assert(
    api.scope === `pr-${pr}` && c.scope === api.scope && c.account === api.account,
    "All Workers must match PR_NUMBER and account",
  );
  return { ...endpoints, content: content.origin, pr };
}

export function hostedTransferRequestKind(config, input) {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch {
    throw new Error("Invalid hosted transfer request URL");
  }
  assert(
    url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash,
    "Unsafe hosted transfer request URL",
  );
  for (const kind of ["api", "upload"]) {
    if (url.origin === config[kind] && url.pathname.startsWith("/v1/")) return kind;
  }
  if (url.origin === config.content && url.pathname.startsWith("/v/")) return "content";
  const capability = `(?:[a-f0-9]{32}|[0-9a-hj-kmnp-tv-z]{5}(?:-[0-9a-hj-kmnp-tv-z]{5}){3})`;
  if (new RegExp(`^${capability}-pr-${config.pr}\\.agent-paste\\.link$`).test(url.hostname)) return "capability";
  throw new Error("Request does not target this PR's transfer Workers or capability hosts");
}
