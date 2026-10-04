import { writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

// Wrangler 4.94 strips auxiliary Workers' ratelimits. Keep native limits on the
// primary Worker and reach them through RPC, rather than weakening local checks.
export async function writeLocalWorker(app, directory, config) {
  const original = `./${relative(directory, config.main)}`;
  const limits = config.ratelimits?.map(({ name }) => name) ?? [];
  const named = app === "api" ? "McpApiEntrypoint" : app === "upload" ? "McpUploadEntrypoint" : null;
  const wrapperPath = resolve(directory, "worker.mjs");
  await writeFile(
    wrapperPath,
    `import * as original from ${JSON.stringify(original)};
export * from ${JSON.stringify(original)};
function prepare(env) {
  for (const name of ${JSON.stringify(limits)}) {
    env[name] = {limit: (options) => env.LOCAL_RATE_LIMITS.limit(${JSON.stringify(app)} + '_' + name, options)};
  }
  return env;
}
${
  named
    ? `export class ${named} extends original.${named} {
  fetchMcp(...args) { prepare(this.env); return super.fetchMcp(...args); }
}`
    : ""
}
export default { ...original.default, async fetch(request, env, ctx) {
  ${
    app === "web"
      ? `if (new URL(request.url).pathname === '/api/auth/sign-in') {
    return new Response(null, {status: 302, headers: {location: '/dashboard',
      'set-cookie': '__agp_session=' + encodeURIComponent(env.LOCAL_DEV_SESSION) + '; Path=/; HttpOnly; SameSite=Lax',
      'cache-control': 'no-store'}});
  }`
      : ""
  }
  ${
    app === "web"
      ? `if (request.method === 'GET' || request.method === 'HEAD') {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
  }`
      : ""
  }
  return original.default.fetch(request, prepare(env), ctx);
}};\n`,
  );
  config.main = wrapperPath;
  if (config.assets) config.assets.run_worker_first = true;
  if (limits.length)
    config.services = [
      ...(config.services ?? []),
      { binding: "LOCAL_RATE_LIMITS", service: "agent-paste-local-gateway", entrypoint: "LocalRateLimits" },
    ];
}

export async function writeLocalGateway(directory, apps, rateLimits) {
  await writeFile(
    resolve(directory, "gateway.mjs"),
    `import {WorkerEntrypoint} from 'cloudflare:workers';
export class LocalRateLimits extends WorkerEntrypoint {
  limit(binding, options) {
    if (!this.env[binding]) throw new Error('Unknown local rate limiter');
    return this.env[binding].limit(options);
  }
}
export default {fetch(request, env) {
  const service = env[request.headers.get('x-local-worker')];
  if (!service) return new Response('Unknown local Worker', {status: 404});
  const forwarded = new Request(request);
  forwarded.headers.delete('x-local-worker');
  return service.fetch(forwarded);
}};\n`,
  );
  const path = resolve(directory, "wrangler.json");
  await writeFile(
    path,
    JSON.stringify({
      name: "agent-paste-local-gateway",
      main: "gateway.mjs",
      compatibility_date: "2026-05-21",
      dev: { ip: "127.0.0.1", port: 8799, inspector_port: 0 },
      ratelimits: rateLimits,
      services: apps.map((app) => ({ binding: app, service: `agent-paste-${app}` })),
    }),
  );
  return path;
}
