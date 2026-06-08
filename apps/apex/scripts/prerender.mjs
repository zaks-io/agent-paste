// Static-site build for apex: produce hashed client assets (the stylesheet + the
// one vanilla enhancement script), an SSR bundle of the route renderer, then
// prerender every route to final HTML referencing those hashed assets. Output is
// dist/client/ — plain static files the worker shim (src/server.ts) serves via
// the ASSETS binding. Zero React ships to the browser.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientOut = resolve(root, "dist/client");
const serverOut = resolve(root, "dist/server");

// Per-env build switches (BILLING_ENABLED, CF_WEB_ANALYTICS_TOKEN) come from
// process.env, which entry-server.tsx reads to bake the right output per env. The
// single source for those values is wrangler.jsonc's per-env `vars`; the deploy
// layer (scripts/deploy.mjs, scripts/deploy-pr-preview.mjs) resolves them from
// there and provides them to this build. A bare local build sees neither set, so
// it fails closed: billing off, no analytics beacon.

// 1) Client build: the stylesheet and the enhancement script become hashed
//    assets, and public/ (fonts, favicons, brand mark) is copied into dist/client.
await build({
  root,
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        styles: resolve(root, "src/styles/apex.css"),
        client: resolve(root, "src/client.ts"),
      },
    },
  },
});

// 2) SSR build: the route renderer, with workspace packages bundled in.
await build({
  root,
  build: {
    outDir: "dist/server",
    emptyOutDir: true,
    ssr: resolve(root, "src/entry-server.tsx"),
  },
});

// 3) Resolve the hashed asset URLs from the client manifest.
const manifest = JSON.parse(await readFile(resolve(clientOut, ".vite/manifest.json"), "utf8"));
const entries = Object.values(manifest);
const cssEntry = manifest["src/styles/apex.css"] ?? entries.find((entry) => entry.file?.endsWith(".css"));
const jsEntry =
  manifest["src/client.ts"] ??
  entries.find((entry) => entry.file?.endsWith(".js") && (entry.name === "client" || entry.src?.includes("client")));
if (!cssEntry?.file || !jsEntry?.file) {
  throw new Error(`Could not resolve hashed assets from manifest: ${JSON.stringify(manifest, null, 2)}`);
}
const assets = { cssHref: `/${cssEntry.file}`, jsHref: `/${jsEntry.file}` };

// The manifest is a build-time index; with run_worker_first the worker would
// otherwise serve it at /.vite/manifest.json. Drop it once the hashes are read.
await rm(resolve(clientOut, ".vite"), { recursive: true, force: true });

// 4) Prerender every route to dist/client/<path>/index.html.
const { render, ROUTE_PATHS } = await import(resolve(serverOut, "entry-server.js"));
let count = 0;
for (const path of ROUTE_PATHS) {
  const html = render(path, assets);
  const rel = path === "/" ? "index.html" : `${path.replace(/^\//, "")}/index.html`;
  const outFile = resolve(clientOut, rel);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html, "utf8");
  count += 1;
}

console.log(`apex: prerendered ${count} routes to dist/client (css=${assets.cssHref}, js=${assets.jsHref})`);
