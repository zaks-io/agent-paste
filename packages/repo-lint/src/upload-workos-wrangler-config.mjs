#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREVIEW_AUTHKIT = "https://courageous-milestone-75-staging.authkit.app";
const PRODUCTION_AUTHKIT = "https://soulful-path-50.authkit.app";

export const UPLOAD_WORKOS_KEYS = [
  "WORKOS_MCP_ISSUER",
  "WORKOS_MCP_JWKS_URL",
  "WORKOS_CLI_ISSUER",
  "WORKOS_CLI_JWKS_URL",
];

export function validateUploadWorkosWranglerConfig(repoRoot) {
  const errors = [];
  const apiConfig = readWranglerConfig(join(repoRoot, "apps/api/wrangler.jsonc"));
  const uploadConfig = readWranglerConfig(join(repoRoot, "apps/upload/wrangler.jsonc"));

  collectUploadEnvAuthKitErrors(uploadConfig, "preview", PREVIEW_AUTHKIT, errors);
  collectUploadEnvAuthKitErrors(uploadConfig, "production", PRODUCTION_AUTHKIT, errors);
  collectUploadApiAlignmentErrors(uploadConfig, apiConfig, "preview", errors);
  collectUploadApiAlignmentErrors(uploadConfig, apiConfig, "production", errors);

  return errors;
}

function collectUploadEnvAuthKitErrors(config, envName, authkitBaseUrl, errors) {
  const vars = config.env?.[envName]?.vars ?? {};
  const jwksUrl = `${authkitBaseUrl}/oauth2/jwks`;

  for (const key of UPLOAD_WORKOS_KEYS) {
    const value = vars[key];
    const expected = key.endsWith("_JWKS_URL") ? jwksUrl : authkitBaseUrl;
    if (value !== expected) {
      errors.push(
        `apps/upload/wrangler.jsonc env.${envName}.vars.${key} is ${JSON.stringify(value)}; expected ${JSON.stringify(expected)}`,
      );
    }
  }
}

function collectUploadApiAlignmentErrors(uploadConfig, apiConfig, envName, errors) {
  const uploadVars = uploadConfig.env?.[envName]?.vars ?? {};
  const apiVars = apiConfig.env?.[envName]?.vars ?? {};

  for (const key of UPLOAD_WORKOS_KEYS) {
    const uploadValue = uploadVars[key];
    const apiValue = apiVars[key];
    if (uploadValue !== apiValue) {
      errors.push(
        `apps/upload/wrangler.jsonc env.${envName}.vars.${key} (${JSON.stringify(uploadValue)}) must match apps/api/wrangler.jsonc (${JSON.stringify(apiValue)})`,
      );
    }
  }
}

function readWranglerConfig(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutLineComments);
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

  console.log("upload-workos-wrangler-config: upload WorkOS MCP/CLI vars align with api");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
