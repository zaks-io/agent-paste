// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveBracesConsumer } from "./braces-patch.mjs";

const PATCH_PATH = "patches/zod@4.4.3.patch";
const PATCH_SHA256 = "85a342777b8a71e8e179f610cf412071450669b312897ee82d140f61296684f2";
const files = {
  "v4/core/schemas.js": "acfbc0314d8d60ffd84b57dc3c9e279651da164e3e21ba7f32904bb65925eb0b",
  "v4/core/schemas.cjs": "70cd683f9fd1993fe531d488754326a967d8add29a78646217be3150ac7c8a47",
};

// Enumerated production-manifest paths, including peer dependencies. New paths fail closed.
export const zodConsumers = `
apps/apex @agent-paste/plans>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/apex @agent-paste/plans>@agent-paste/contracts>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/apex @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/api @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/content @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/gateway>@ai-sdk/provider-utils>zod 4.4.3
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/gateway>zod 4.4.3
apps/evals @openrouter/ai-sdk-provider>ai>@ai-sdk/provider-utils>zod 4.4.3
apps/evals @openrouter/ai-sdk-provider>ai>zod 4.4.3
apps/evals @openrouter/ai-sdk-provider>zod 4.4.3
apps/evals ai>@ai-sdk/gateway>@ai-sdk/provider-utils>zod 4.4.3
apps/evals ai>@ai-sdk/gateway>zod 4.4.3
apps/evals ai>@ai-sdk/provider-utils>zod 4.4.3
apps/evals ai>zod 4.4.3
apps/evals zod 4.4.3
apps/jobs @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/contracts>zod 4.4.3
apps/jobs @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/jobs @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/jobs zod 4.4.3
apps/mcp @agent-paste/api-client>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/api-client>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/mcp @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/stream @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/stream @agent-paste/contracts>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/stream @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/upload @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/plans>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/plans>@agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/contracts>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
apps/web @agent-paste/worker-runtime>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
packages/api-client @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/api-client @agent-paste/contracts>zod 4.4.3
packages/auth @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/auth @agent-paste/contracts>zod 4.4.3
packages/auth @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/auth @agent-paste/db>@agent-paste/contracts>zod 4.4.3
packages/contracts @asteasolutions/zod-to-openapi>zod 4.4.3
packages/contracts zod 4.4.3
packages/db @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/db @agent-paste/contracts>zod 4.4.3
packages/plans @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/plans @agent-paste/contracts>zod 4.4.3
packages/worker-runtime @agent-paste/auth>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/worker-runtime @agent-paste/auth>@agent-paste/contracts>zod 4.4.3
packages/worker-runtime @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/worker-runtime @agent-paste/auth>@agent-paste/db>@agent-paste/contracts>zod 4.4.3
packages/worker-runtime @agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/worker-runtime @agent-paste/contracts>zod 4.4.3
packages/worker-runtime @agent-paste/db>@agent-paste/contracts>@asteasolutions/zod-to-openapi>zod 4.4.3
packages/worker-runtime @agent-paste/db>@agent-paste/contracts>zod 4.4.3
`
  .trim()
  .split("\n")
  .map((line) => {
    const [workspace, chain, version] = line.split(" ");
    return { workspace, chain: chain.split(">"), version };
  });

/** Verify the pinned patch and every enumerated installed consumer before disposition.
 * @param {string} repoRoot
 */
export function verifyZodPatch(repoRoot) {
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(digest(join(repoRoot, PATCH_PATH)), PATCH_SHA256, "Unexpected Zod patch bytes");
  assert(
    readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").includes(`\n  zod@4.4.3: ${PATCH_PATH}\n`),
    "Missing Zod patch registration",
  );
  for (const path of ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"]) {
    const lock = readFileSync(join(repoRoot, path), "utf8");
    assert(
      lock.includes(`  zod@4.4.3:\n    hash: ${PATCH_SHA256}\n    path: ${PATCH_PATH}\n`),
      "Missing locked Zod patch",
    );
    const snapshots = lock.split("\nsnapshots:\n")[1] ?? "";
    const references = [...snapshots.matchAll(/^\s+zod: (.+)$/gm)].map((m) => m[1]);
    assert(
      references.length > 0 && references.every((v) => v === "3.25.76" || v === `4.4.3(patch_hash=${PATCH_SHA256})`),
      "Unpatched Zod lock reference",
    );
  }
  const verified = new Set();
  for (const consumer of zodConsumers) {
    const directory = resolveBracesConsumer(repoRoot, consumer);
    const require = createRequire(join(directory, "package.json"));
    assert.equal(require("./package.json").version, consumer.version, "Unexpected Zod consumer version");
    if (verified.has(directory)) continue;
    for (const [path, hash] of Object.entries(files))
      assert.equal(digest(join(directory, path)), hash, "Installed Zod parser differs from patch");
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
    patchSha256: PATCH_SHA256,
    parserSha256: files,
    verifiedCopies: [...verified],
    paths: zodConsumers,
  };
}
