import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const outfile = "dist/index.js";

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.tsx"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  logLevel: "info",
});

await chmod(new URL(outfile, import.meta.url), 0o755);
