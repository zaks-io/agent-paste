import { readFileSync } from "node:fs";
import { parse, printParseErrorCode } from "jsonc-parser";

export function readWranglerConfig(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const details = errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", ");
    throw new Error(`Invalid Wrangler JSONC in ${absolutePath}: ${details}`);
  }
  return config;
}
