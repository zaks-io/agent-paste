import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateContentCapabilityWranglerConfig } from "./content-capability-wrangler-config.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("content-capability-wrangler-config", () => {
  it("passes against the checked-in api and content wrangler configs", () => {
    expect(validateContentCapabilityWranglerConfig(repoRoot)).toEqual([]);
  });

  it("fails when the production capability domains drift", () => {
    const tempRoot = copyConfigs();
    try {
      const apiPath = join(tempRoot, "apps/api/wrangler.jsonc");
      writeFileSync(
        apiPath,
        readFileSync(apiPath, "utf8").replaceAll(
          '"CONTENT_CAPABILITY_DOMAIN": "agent-paste.sh"',
          '"CONTENT_CAPABILITY_DOMAIN": "content.example.test"',
        ),
      );

      expect(validateContentCapabilityWranglerConfig(tempRoot).join("\n")).toContain("CONTENT_CAPABILITY_DOMAIN");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects the legacy suffixed production route", () => {
    const tempRoot = copyConfigs();
    try {
      const contentPath = join(tempRoot, "apps/content/wrangler.jsonc");
      writeFileSync(
        contentPath,
        readFileSync(contentPath, "utf8").replace("*.agent-paste.sh/*", "*-uc.agent-paste.sh/*"),
      );

      expect(validateContentCapabilityWranglerConfig(tempRoot).join("\n")).toContain("exactly one");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate capability routes", () => {
    const tempRoot = copyConfigs();
    try {
      const contentPath = join(tempRoot, "apps/content/wrangler.jsonc");
      const content = readFileSync(contentPath, "utf8");
      const capabilityRoute = `          "pattern": "*.agent-paste.sh/*",
          "zone_name": "agent-paste.sh"
        }`;
      writeFileSync(
        contentPath,
        content.replace(
          capabilityRoute,
          `${capabilityRoute},\n        {\n          "pattern": "*.agent-paste.sh/*",\n          "zone_name": "agent-paste.sh"\n        }`,
        ),
      );

      expect(validateContentCapabilityWranglerConfig(tempRoot).join("\n")).toContain("exactly one");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a missing product-origin forwarding host", () => {
    const tempRoot = copyConfigs();
    try {
      const contentPath = join(tempRoot, "apps/content/wrangler.jsonc");
      writeFileSync(contentPath, readFileSync(contentPath, "utf8").replace("api.agent-paste.sh,", ""));

      expect(validateContentCapabilityWranglerConfig(tempRoot).join("\n")).toContain("CONTENT_ROUTE_ORIGIN_HOSTS");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects any additional agent-paste.sh route in preview", () => {
    const tempRoot = copyConfigs();
    try {
      const contentPath = join(tempRoot, "apps/content/wrangler.jsonc");
      const content = readFileSync(contentPath, "utf8");
      const capabilityRoute = `          "pattern": "*-preview.agent-paste.sh/*",
          "zone_name": "agent-paste.sh"
        }`;
      writeFileSync(
        contentPath,
        content.replace(
          capabilityRoute,
          `${capabilityRoute},\n        {\n          "pattern": "*.agent-paste.sh/*",\n          "zone_name": "agent-paste.sh"\n        }`,
        ),
      );

      expect(validateContentCapabilityWranglerConfig(tempRoot).join("\n")).toContain("non-preview");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function copyConfigs() {
  const tempRoot = mkdtempSync(join(tmpdir(), "content-capability-config-"));
  for (const app of ["api", "content", "web"]) {
    const source = join(repoRoot, "apps", app, "wrangler.jsonc");
    const targetDir = join(tempRoot, "apps", app);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "wrangler.jsonc"), readFileSync(source, "utf8"));
  }
  return tempRoot;
}
