import { readFileSync } from "node:fs";

export function readWranglerConfig(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutLineComments);
}
