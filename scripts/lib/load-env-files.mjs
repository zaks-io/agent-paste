import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFiles(paths, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const shellKeys = new Set(Object.keys(env));
  const loaded = [];

  for (const path of paths) {
    const file = resolve(cwd, path);
    if (!existsSync(file)) {
      continue;
    }

    for (const [key, value] of parseEnvFile(readFileSync(file, "utf8"))) {
      if (shellKeys.has(key)) {
        continue;
      }
      env[key] = value;
    }
    loaded.push(file);
  }

  return loaded;
}

export function parseEnvFile(text) {
  const values = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const index = assignment.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = assignment.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values.push([key, unquote(stripInlineComment(assignment.slice(index + 1).trim()))]);
  }
  return values;
}

function stripInlineComment(value) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
