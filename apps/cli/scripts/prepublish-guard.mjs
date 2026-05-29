import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// 1. License gate. The CLI ships UNLICENSED until the open-core decision lands;
//    publishing proprietary code to a public registry is the mistake we are
//    guarding against. Flip this once a real OSI license + LICENSE file exist.
if (!pkg.license || pkg.license === "UNLICENSED") {
  fail(
    `publish is blocked while license is "${pkg.license ?? "missing"}". ` +
      "Set an OSI license and add a LICENSE file before publishing.",
  );
}

// 2. Build the bundle the same way CI does, then assert on its output.
execFileSync("node", ["build.mjs"], { cwd: root, stdio: "inherit" });

const bundle = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");

// 3. The bundle must be self-contained: no workspace:* deps can leak through,
//    or `npm i @zaks-io/agent-paste` breaks on an uninstallable @agent-paste/* import.
if (/@agent-paste\//.test(bundle)) {
  fail("bundled dist/index.js still references @agent-paste/* workspace deps; the build did not inline them.");
}

// 4. The only runtime dependency may be @napi-rs/keyring (ships native .node
//    binaries, intentionally left external). Anything else is a packaging bug.
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const unexpected = runtimeDeps.filter((name) => name !== "@napi-rs/keyring");
if (unexpected.length > 0) {
  fail(`unexpected runtime dependencies (must be bundled or devDeps): ${unexpected.join(", ")}`);
}

// 5. The files allowlist must ship exactly the build output and nothing stray.
const files = pkg.files ?? [];
for (const required of ["dist", "README.md"]) {
  if (!files.includes(required)) fail(`package.json "files" must include "${required}".`);
}

console.error("prepublish-guard: all checks passed.");
