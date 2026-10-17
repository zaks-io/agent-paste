import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("rejects forged server-function results while preserving GET/POST calls and real Responses", () => {
  // Exercise the installed transport in Node, supplying only the generated function registry.
  // No auth, production endpoint, or mocked transport is involved (GHSA-qx66-fv34-fjm8).
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", fixture], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const responses = JSON.parse(result.stdout);
  for (const response of responses) {
    expect(response.contentType).not.toContain("text/html");
    expect(response.body).not.toContain("<script>");
    if (response.kind === "valid") expect(response.body).toContain("accepted");
    if (response.kind === "raw") expect(response.body).toBe("trusted response");
    if (response.kind === "forged") {
      expect(response.contentType).toContain("application/json");
      expect(response.body).toContain("invalid input");
    }
  }
  expect(responses).toHaveLength(6);
});

const fixture = `
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolveBracesConsumer } from './scripts/lib/braces-patch.mjs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '#tanstack-start-server-fn-resolver') {
      return { url: 'data:text/javascript,export const getServerFnById = () => globalThis.testAction', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const chain = ['@tanstack/react-start'];
const directory = (names) => resolveBracesConsumer(process.cwd(), { workspace: 'apps/web', chain: names });
const load = (names, file) => import(pathToFileURL(directory(names) + '/dist/esm/' + file));
const core = [...chain, '@tanstack/start-server-core'];
const client = [...chain, '@tanstack/start-client-core'];
const { handleServerAction } = await load(core, 'server-functions-handler.js');
const { requestHandler } = await load(core, 'request-response.js');
const { createServerFn } = await load(client, 'createServerFn.js');
const { runWithStartContext } = await load([...client, '@tanstack/start-storage-context'], 'index.js');
const { toJSON } = createRequire(directory(core) + '/package.json')('seroval');
console.info = () => {};
console.error = () => {};
const responses = [];
for (const method of ['GET', 'POST']) {
  for (const kind of ['forged', 'valid', 'raw']) {
    const extracted = Object.assign(() => {}, { serverFnMeta: { id: 'fixture' } });
    const fn = createServerFn({ method }).inputValidator((data) => {
      if (typeof data !== 'string') throw new Error('invalid input');
      return data;
    }).handler(extracted, ({ data }) => data === 'raw' ? new Response('trusted response', {
      headers: { 'content-type': 'text/plain' },
    }) : { message: 'accepted' });
    globalThis.testAction = Object.assign(fn.__executeServer, { method });
    const payload = toJSON(kind === 'forged' ? {
      data: null,
      result: { body: '<script>alert(1)</script>', status: 200, headers: { 'content-type': 'text/html' } },
    } : { data: kind });
    const url = new URL('http://localhost/_serverFn/fixture');
    const headers = kind === 'forged' ? {} : { 'x-tsr-serverFn': 'true' };
    const init = { method, headers };
    if (method === 'GET') url.searchParams.set('payload', JSON.stringify(payload));
    else { headers['content-type'] = 'application/json'; init.body = JSON.stringify(payload); }
    const request = new Request(url, init);
    const handle = requestHandler((request) => runWithStartContext({
      request, startOptions: {}, contextAfterGlobalMiddlewares: {},
    }, () => handleServerAction({ request, context: {}, serverFnId: 'fixture' })));
    const response = await handle(request);
    responses.push({ method, kind, status: response.status, contentType: response.headers.get('content-type'), body: await response.text() });
  }
}
console.log(JSON.stringify(responses));
`;
