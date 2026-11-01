// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveBracesConsumer } from "./braces-patch.mjs";
import { verifyZodBuildConsumers } from "./zod-build-policy.mjs";
import { zodLighthouseFinding } from "./zod-lighthouse-policy.mjs";

const ZOD_VERSION = "4.6.6";
const LIGHTHOUSE_ZOD_VERSION = zodLighthouseFinding.version;
const ZOD_OVERRIDE = "zod@>=4.0.0 <5.0.0";
// Published Zod 4.6.6 parsers. Upstream capSize rejects oversized arrays before element checks.
const files = {
  "v4/core/schemas.js": "0ee56e8afbae28eeb1060a162ad7e56f0675ee6fb83f0ae56bea2e088f6cdbc0",
  "v4/core/schemas.cjs": "7e35563b275bcc457a6d8ae0f5e1354b3c499ddd38401439f16bed1b8f357e41",
};

// Enumerated production-manifest paths, including peer dependencies. New paths fail closed.
export const zodConsumers = `
apps/apex @agent-paste/plans>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/apex @agent-paste/plans>@agent-paste/contracts>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/apex @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/api @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/content @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/gateway>@ai-sdk/provider-utils>zod 4.6.6
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/gateway>zod 4.6.6
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/provider-utils>zod 4.6.6
apps/evals @openrouter/ai-sdk-provider>ai>zod 4.6.6
apps/evals @openrouter/ai-sdk-provider>zod 4.6.6
apps/evals ai>@ai-sdk/gateway>@ai-sdk/provider-utils>zod 4.6.6
apps/evals ai>@ai-sdk/gateway>zod 4.6.6
apps/evals ai>@ai-sdk/provider-utils>zod 4.6.6
apps/evals ai>zod 4.6.6
apps/evals zod 4.6.6
apps/jobs @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/contracts>zod 4.6.6
apps/jobs @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/jobs @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/jobs zod 4.6.6
apps/mcp @agent-paste/api-client>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/api-client>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/mcp @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/stream @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/stream @agent-paste/contracts>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/stream @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/upload @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/plans>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/plans>@agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
apps/web @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
packages/api-client @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/api-client @agent-paste/contracts>zod 4.6.6
packages/auth @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/auth @agent-paste/contracts>zod 4.6.6
packages/auth @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/auth @agent-paste/db>@agent-paste/contracts>zod 4.6.6
packages/contracts @asteasolutions/zod-to-openapi>zod 4.6.6
packages/contracts zod 4.6.6
packages/db @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/db @agent-paste/contracts>zod 4.6.6
packages/plans @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/plans @agent-paste/contracts>zod 4.6.6
packages/worker-runtime @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/worker-runtime @agent-paste/auth>@agent-paste/contracts>zod 4.6.6
packages/worker-runtime @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/worker-runtime @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.6.6
packages/worker-runtime @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/worker-runtime @agent-paste/contracts>zod 4.6.6
packages/worker-runtime @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.6.6
packages/worker-runtime @agent-paste/db>@agent-paste/contracts>zod 4.6.6
`
  .trim()
  .split("\n")
  .map((line) => {
    const [workspace, chain, version] = line.split(" ");
    return { workspace, chain: chain.split(">"), version };
  });

/** Verify the upstream Zod 4.6.6 parser and every enumerated installed consumer.
 * Lighthouse's Zod 3 dependency stays on 3.25.76; a Zod 4 override must not replace it.
 * @param {string} repoRoot
 */
export function verifyZodPatch(repoRoot) {
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.equal(rootManifest.pnpm?.overrides?.[ZOD_OVERRIDE], ZOD_VERSION, "Missing Zod 4 security override");
  assert(
    !Object.keys(rootManifest.pnpm?.patchedDependencies ?? {}).some((key) => key.startsWith("zod@")),
    "Unexpected Zod patch registration",
  );
  assert(
    !/^\s*zod@/m.test(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8")),
    "Unexpected Zod patch registration",
  );
  for (const path of ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"]) {
    const lock = readFileSync(join(repoRoot, path), "utf8");
    assert(!lock.includes("patches/zod@"), "Unexpected locked Zod patch");
    const snapshots = lock.split("\nsnapshots:\n")[1] ?? "";
    const references = [...snapshots.matchAll(/^\s+zod: (.+)$/gm)].map((m) => m[1]);
    assert(
      references.length > 0 &&
        references.every((version) => version === LIGHTHOUSE_ZOD_VERSION || version === ZOD_VERSION),
      "Unexpected Zod lock reference",
    );
  }
  const verified = new Set();
  for (const consumer of zodConsumers) {
    const directory = resolveBracesConsumer(repoRoot, consumer);
    const require = createRequire(join(directory, "package.json"));
    assert.equal(require("./package.json").version, consumer.version, "Unexpected Zod consumer version");
    if (verified.has(directory)) continue;
    for (const [path, hash] of Object.entries(files))
      assert.equal(digest(join(directory, path)), hash, "Installed Zod parser differs from the reviewed parser");
    const z = require(join(directory, "index.cjs"));
    let calls = 0;
    const schema = z.array(z.string().superRefine(() => calls++)).max(100);
    const result = schema.safeParse(Array(1000).fill("value"));
    assert.equal(result.success, false);
    assert.equal(calls, 0, "Oversized array elements were validated");
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
    assert.equal(schema.safeParse(Array(100).fill("value")).success, true);
    verified.add(directory);
  }
  return {
    version: ZOD_VERSION,
    parserSha256: files,
    verifiedCopies: [...verified],
    paths: zodConsumers,
    build: verifyZodBuildConsumers(repoRoot),
  };
}
