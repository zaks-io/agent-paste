#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const goldensDir = join(repoRoot, "packages", "contracts", "openapi");

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");

const builtIndex = join(repoRoot, "packages", "contracts", "dist", "openapi", "index.js");
let module;
try {
  module = await import(builtIndex);
} catch (error) {
  console.error(`failed to import ${builtIndex}: ${error?.message ?? error}`);
  console.error("did you run `pnpm --filter @agent-paste/contracts build`?");
  process.exit(2);
}

const { buildApiOpenApiDocument, buildContentOpenApiDocument, buildUploadOpenApiDocument } = module;

const docs = {
  api: buildApiOpenApiDocument(),
  upload: buildUploadOpenApiDocument(),
  content: buildContentOpenApiDocument(),
};

mkdirSync(goldensDir, { recursive: true });

let drift = false;
for (const [name, doc] of Object.entries(docs)) {
  const file = join(goldensDir, `${name}.json`);
  const next = `${JSON.stringify(doc, null, 2)}\n`;

  if (shouldWrite) {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
    continue;
  }

  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    drift = true;
    console.error(`missing golden: ${file}`);
    continue;
  }

  if (current !== next) {
    drift = true;
    console.error(`drift detected in ${file}; run \`pnpm openapi:write\` to refresh.`);
  }
}

if (!shouldWrite && drift) {
  process.exit(1);
}
