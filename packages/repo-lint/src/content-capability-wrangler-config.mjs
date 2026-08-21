#!/usr/bin/env node
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readWranglerConfig } from "./wrangler-config.mjs";

const CAPABILITY_DOMAIN = "agent-paste.sh";
const CAPABILITY_ROUTE = "*-uc.agent-paste.sh/*";

export function validateContentCapabilityWranglerConfig(repoRoot) {
  const apiConfig = readWranglerConfig(join(repoRoot, "apps/api/wrangler.jsonc"));
  const contentConfig = readWranglerConfig(join(repoRoot, "apps/content/wrangler.jsonc"));
  const errors = [];

  for (const [app, config] of [
    ["api", apiConfig],
    ["content", contentConfig],
    ["web", readWranglerConfig(join(repoRoot, "apps/web/wrangler.jsonc"))],
  ]) {
    const productionDomain = config.env?.production?.vars?.CONTENT_CAPABILITY_DOMAIN;
    if (productionDomain !== CAPABILITY_DOMAIN) {
      errors.push(
        `apps/${app}/wrangler.jsonc env.production.vars.CONTENT_CAPABILITY_DOMAIN is ${JSON.stringify(productionDomain)}; expected ${JSON.stringify(CAPABILITY_DOMAIN)}`,
      );
    }
    const previewDomain = config.env?.preview?.vars?.CONTENT_CAPABILITY_DOMAIN;
    if (previewDomain !== undefined) {
      errors.push(
        `apps/${app}/wrangler.jsonc env.preview.vars.CONTENT_CAPABILITY_DOMAIN must stay unset; received ${JSON.stringify(previewDomain)}`,
      );
    }
  }

  const productionRoutes = contentConfig.env?.production?.routes ?? [];
  const capabilityRoutes = productionRoutes.filter((route) => route.pattern === CAPABILITY_ROUTE);
  const [capabilityRoute] = capabilityRoutes;
  if (
    capabilityRoutes.length !== 1 ||
    capabilityRoute?.zone_name !== CAPABILITY_DOMAIN ||
    capabilityRoute.custom_domain === true
  ) {
    errors.push(
      `apps/content/wrangler.jsonc production must contain exactly one ${CAPABILITY_ROUTE} route through zone_name ${CAPABILITY_DOMAIN}`,
    );
  }
  const unexpectedZoneRoutes = productionRoutes.filter(
    (route) => route.zone_name === CAPABILITY_DOMAIN && route.pattern !== CAPABILITY_ROUTE,
  );
  for (const route of unexpectedZoneRoutes) {
    errors.push(
      `apps/content/wrangler.jsonc production route ${JSON.stringify(route.pattern)} can capture non-capability agent-paste.sh hosts`,
    );
  }

  return errors;
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const errors = validateContentCapabilityWranglerConfig(repoRoot);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`content-capability-wrangler-config: ${error}`);
    }
    process.exit(1);
  }

  console.log("content-capability-wrangler-config: production capability routing is aligned");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
