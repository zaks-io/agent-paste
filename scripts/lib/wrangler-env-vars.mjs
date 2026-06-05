// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadWranglerEnvVars(path, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const envName = options.envName;
  const keys = options.keys ? new Set(options.keys) : undefined;
  const file = resolve(cwd, path);
  if (!existsSync(file)) {
    return [];
  }

  const vars = wranglerEnvVars(readFileSync(file, "utf8"), envName);
  const loaded = [];
  for (const [key, value] of Object.entries(vars)) {
    if (keys && !keys.has(key)) {
      continue;
    }
    if (env[key] !== undefined) {
      continue;
    }
    env[key] = String(value);
    loaded.push(key);
  }
  return loaded;
}

export function wranglerEnvVars(text, envName) {
  const config = JSON.parse(stripJsonComments(text));
  const vars = envName ? config.env?.[envName]?.vars : config.vars;
  return vars && typeof vars === "object" ? vars : {};
}

function stripJsonComments(text) {
  const state = {
    blockComment: false,
    index: 0,
    lineComment: false,
    output: "",
    quote: "",
  };

  for (; state.index < text.length; state.index += 1) {
    consumeJsoncChar(state, text);
  }

  return state.output;
}

function consumeJsoncChar(state, text) {
  const char = text[state.index];
  const next = text[state.index + 1];

  if (consumeLineComment(state, char)) return;
  if (consumeBlockComment(state, char, next)) return;
  if (consumeQuotedChar(state, text, char)) return;
  if (startQuote(state, char)) return;
  if (startLineComment(state, char, next)) return;
  if (startBlockComment(state, char, next)) return;

  state.output += char;
}

function consumeLineComment(state, char) {
  if (!state.lineComment) return false;
  if (char === "\n" || char === "\r") {
    state.lineComment = false;
    state.output += char;
  }
  return true;
}

function consumeBlockComment(state, char, next) {
  if (!state.blockComment) return false;
  if (char === "*" && next === "/") {
    state.blockComment = false;
    state.index += 1;
  } else if (char === "\n" || char === "\r") {
    state.output += char;
  }
  return true;
}

function consumeQuotedChar(state, text, char) {
  if (!state.quote) return false;
  state.output += char;
  if (char === state.quote && text[state.index - 1] !== "\\") {
    state.quote = "";
  }
  return true;
}

function startQuote(state, char) {
  if (char !== '"' && char !== "'") return false;
  state.quote = char;
  state.output += char;
  return true;
}

function startLineComment(state, char, next) {
  if (char !== "/" || next !== "/") return false;
  state.lineComment = true;
  state.index += 1;
  return true;
}

function startBlockComment(state, char, next) {
  if (char !== "/" || next !== "*") return false;
  state.blockComment = true;
  state.index += 1;
  return true;
}
