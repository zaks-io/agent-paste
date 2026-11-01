// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveBracesConsumer } from "./braces-patch.mjs";

// These parsers consume inline Vite options and tsr.config.json from the repository.
// They resolve the same upstream-fixed Zod 4.6.6 release as the runtime consumers.
const configParsers = {
  "@tanstack/start-plugin-core": [
    "dist/esm/schema.js",
    "9196384bf54560b159fb787d337dbb1ee87d46b892d62c23d8f5db3d71b67753",
  ],
  "@tanstack/router-generator": [
    "dist/esm/config.js",
    "0d80d6b251c6cd15493c45e97e17185966b9d65752492807c6d4c114b0dc5cb3",
  ],
  "@tanstack/router-plugin": [
    "dist/esm/core/config.js",
    "1139a693e77e76ef03ccd117e8c01ce84fbab687fd206d9ed0692c94fd6a9188",
  ],
};

export const zodBuildConsumers = [
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>@tanstack/router-generator@1.167.40>zod@4.6.6",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>@tanstack/router-generator@1.167.40>zod@4.6.6",
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>zod@4.6.6",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>zod@4.6.6",
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>@tanstack/router-plugin@1.168.42>zod@4.6.6",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.60>@tanstack/react-start-rsc@0.1.59>@tanstack/start-plugin-core@1.171.49>@tanstack/router-plugin@1.168.42>zod@4.6.6",
].map((path) => {
  const expectedPath = path.split(">");
  return {
    workspace: "apps/web",
    chain: expectedPath.slice(1).map((part) => part.slice(0, part.lastIndexOf("@"))),
    expectedPath,
    version: "4.6.6",
  };
});

/** Verify the exact build-only consumer paths and reviewed config parser bytes.
 * @param {string} repoRoot
 */
export function verifyZodBuildConsumers(repoRoot) {
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const consumer of zodBuildConsumers) {
    for (let i = 0; i < consumer.expectedPath.length; i++) {
      const directory =
        i === 0
          ? join(repoRoot, consumer.workspace)
          : resolveBracesConsumer(repoRoot, { workspace: consumer.workspace, chain: consumer.chain.slice(0, i) });
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      assert.equal(
        `${manifest.name}@${manifest.version}`,
        consumer.expectedPath[i],
        "Unreviewed Zod build dependency path",
      );
      const parser = configParsers[manifest.name];
      if (parser) assert.equal(digest(join(directory, parser[0])), parser[1], "Unreviewed TanStack config parser");
    }
    const directory = resolveBracesConsumer(repoRoot, consumer);
    assert.equal(
      createRequire(join(directory, "package.json"))(join(directory, "package.json")).version,
      consumer.version,
    );
  }
  return { paths: zodBuildConsumers.map((c) => c.expectedPath), configParsers };
}
