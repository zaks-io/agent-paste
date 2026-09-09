#!/usr/bin/env node
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readWranglerConfig } from "./wrangler-config.mjs";

export function validateUploadWorkosWranglerConfig(repoRoot) {
  const config = readWranglerConfig(join(repoRoot, "apps/upload/wrangler.jsonc"));
  const errors = [];

  for (const [scope, vars] of varsByScope(config)) {
    for (const key of Object.keys(vars)) {
      if (key.startsWith("WORKOS_")) {
        errors.push(`apps/upload/wrangler.jsonc ${scope}.${key} must not be bound; MCP OAuth terminates at mcp`);
      }
    }
  }
  for (const envName of ["preview", "production"]) {
    const required = config.env?.[envName]?.secrets?.required ?? [];
    for (const key of required) {
      if (key.startsWith("WORKOS_")) {
        errors.push(`apps/upload/wrangler.jsonc env.${envName}.secrets.required must not contain ${key}`);
      }
    }
  }
  return errors;
}

function varsByScope(config) {
  return [
    ["vars", config.vars ?? {}],
    ["env.preview.vars", config.env?.preview?.vars ?? {}],
    ["env.production.vars", config.env?.production?.vars ?? {}],
  ];
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const errors = validateUploadWorkosWranglerConfig(repoRoot);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`upload-workos-wrangler-config: ${error}`);
    }
    process.exit(1);
  }
  console.log("upload-workos-wrangler-config: upload has no WorkOS bindings");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
