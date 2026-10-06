// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveBracesConsumer } from "./braces-patch.mjs";

// These parsers consume inline Vite options and tsr.config.json from the repository.
const configParsers = {
  "@tanstack/start-plugin-core": [
    "dist/esm/schema.js",
    "9f795461959186b53dc156da8a62919915c3cdfd1eeaa71eab1ff916e6f47bf7",
  ],
  "@tanstack/router-generator": [
    "dist/esm/config.js",
    "425ce39e45e8f8a31ea4f84a71c33bdcf127bdcf0ff5e00a31b7b7a9a6b1a99f",
  ],
  "@tanstack/router-plugin": [
    "dist/esm/core/config.js",
    "4f2a720f42fd216d8209ad14f729b70c9b7867e167394e969edabccc6caf2e5b",
  ],
};

export const zodBuildConsumers = [
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>@tanstack/router-generator@1.167.5>zod@3.25.76",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>@tanstack/router-generator@1.167.5>zod@3.25.76",
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>zod@3.25.76",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>zod@3.25.76",
  "@agent-paste/web@0.0.0>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>@tanstack/router-plugin@1.168.6>zod@3.25.76",
  "@agent-paste/web@0.0.0>@workos/authkit-tanstack-react-start@0.8.3>@tanstack/react-start@1.168.6>@tanstack/react-start-rsc@0.1.6>@tanstack/start-plugin-core@1.170.6>@tanstack/router-plugin@1.168.6>zod@3.25.76",
].map((path) => {
  const expectedPath = path.split(">");
  return {
    workspace: "apps/web",
    chain: expectedPath.slice(1).map((part) => part.slice(0, part.lastIndexOf("@"))),
    expectedPath,
    version: "3.25.76",
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
