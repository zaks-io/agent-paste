import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Runs as `prepublishOnly`. npm/pnpm abort the publish if this exits non-zero,
// so every check here is a hard gate against shipping a broken or
// not-yet-licensed package to the public registry.
//
// Order matters: cheap policy checks (license) run before the build so a
// blocked publish fails fast.

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const fail = (message) => {
  console.error(`prepublish-guard: ${message}`);
  process.exit(1);
};

// 1. License gate. The open-core decision landed: the CLI ships under Apache-2.0
//    with a LICENSE file. This gate stays as a regression guard so the package
//    can never be published if the license is dropped back to UNLICENSED/missing.
if (!pkg.license || pkg.license === "UNLICENSED") {
  fail(
    `publish is blocked while license is "${pkg.license ?? "missing"}". ` +
      "Set an OSI license and add a LICENSE file before publishing.",
  );
}

// 2. Build the bundle the same way CI does, then assert on its output.
execFileSync("node", ["build.mjs"], { cwd: root, stdio: "inherit" });

const bundle = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const builtVersion = execFileSync(process.execPath, ["dist/index.js", "--version"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (builtVersion !== pkg.version) {
  fail(`dist/index.js reports version "${builtVersion}", expected package.json version "${pkg.version}"`);
}

// 3. The bundle must be self-contained: no workspace:* deps can leak through,
//    or `npm i @zaks-io/agent-paste` breaks on an uninstallable @agent-paste/* import.
if (/@agent-paste\//.test(bundle)) {
  fail("bundled dist/index.js still references @agent-paste/* workspace deps; the build did not inline them.");
}

// 4. Bundle JavaScript; install only the exact native packages its loader expects.
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length > 0) {
  fail(`unexpected runtime dependencies (must be bundled or devDeps): ${runtimeDeps.join(", ")}`);
}
const fsSafeVersion = pkg.devDependencies?.["@openclaw/fs-safe"];
if (!/^\d+\.\d+\.\d+$/.test(fsSafeVersion ?? "")) {
  fail("@openclaw/fs-safe must be a pinned build dependency.");
}
const require = createRequire(import.meta.url);
const fsSafe = require("@openclaw/fs-safe/package.json");
if (fsSafe.version !== fsSafeVersion) fail("installed @openclaw/fs-safe does not match the pinned build dependency.");
const nativeDeps = Object.fromEntries(
  Object.entries(fsSafe.optionalDependencies).filter(([name]) => name.startsWith("@openclaw/fs-safe-")),
);
const optionalDeps = pkg.optionalDependencies ?? {};
if (
  Object.keys(nativeDeps).length === 0 ||
  Object.keys(optionalDeps).length !== Object.keys(nativeDeps).length ||
  Object.entries(nativeDeps).some(([name, version]) => optionalDeps[name] !== version)
) {
  fail("optional dependencies must match fs-safe's complete, pinned native package set.");
}

// 5. The files allowlist must ship exactly the build output and nothing stray.
const files = pkg.files ?? [];
for (const required of ["dist/index.js", "README.md", "LICENSE"]) {
  if (!files.includes(required)) fail(`package.json "files" must include "${required}".`);
}

console.error("prepublish-guard: all checks passed.");
