import type { GlobalFlags } from "./global-flags.js";
import { type OutputMode, resolveMode } from "./render.js";

export type { GlobalFlags };

export const SCHEMA_VERSION = "1";

export type Parsed = {
  command: string[];
  positionals: string[];
  flags: Map<string, string | boolean>;
  global: GlobalFlags;
};

export function parseArgs(argv: string[]): Parsed {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      if (raw.startsWith("no-")) {
        flags.set(raw.slice(3), false);
        continue;
      }
      const [name, inlineValue] = raw.split("=", 2);
      if (!name) {
        continue;
      }
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
      } else if (takesValue(name)) {
        index += 1;
        const value = argv[index];
        if (!value) {
          throw new Error(`Missing value for --${name}`);
        }
        flags.set(name, value);
      } else {
        flags.set(name, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  const command = commandParts(positionals);
  return {
    command,
    positionals: positionals.slice(command.length),
    flags,
    global: {
      json: booleanFlag({ flags }, "json", false),
      quiet: booleanFlag({ flags }, "quiet", false),
      color: optionalBooleanFlag({ flags }, "color"),
    },
  };
}

function commandParts(positionals: string[]) {
  const first = positionals[0] ?? "";
  return first ? [first] : [];
}

function takesValue(name: string) {
  return new Set([
    "claim-code",
    "artifact-id",
    "title",
    "entrypoint",
    "render-mode",
    "name",
    "revision-id",
    "edits",
  ]).has(name);
}

export function requiredArg(parsed: Parsed, index: number, label: string) {
  const value = parsed.positionals[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

export function stringFlag(parsed: Parsed, name: string) {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(parsed: Pick<Parsed, "flags">, name: string, fallback: boolean) {
  const value = parsed.flags.get(name);
  return typeof value === "boolean" ? value : fallback;
}

// Tri-state: --color forces rich, --no-color forces plain, absent (undefined)
// defers to TTY/NO_COLOR/CI detection in resolveMode.
export function optionalBooleanFlag(parsed: Pick<Parsed, "flags">, name: string): boolean | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "boolean" ? value : undefined;
}

export function outputModeFor(global: GlobalFlags): OutputMode {
  return resolveMode({
    json: global.json,
    color: global.color,
    env: {
      isTTY: Boolean(process.stdout.isTTY),
      NO_COLOR: process.env.NO_COLOR,
      CI: process.env.CI,
      TERM: process.env.TERM,
    },
  });
}

export async function output(value: unknown, global: GlobalFlags, human = JSON.stringify(value, null, 2)) {
  if (global.json) {
    const payload =
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>), schema_version: SCHEMA_VERSION }
        : { schema_version: SCHEMA_VERSION, value };
    await writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!global.quiet) {
    await writeStdout(`${human}\n`);
  }
}

export function writeStdout(value: string) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(value, (error?: unknown) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// POSIX single-quote escaping for a path embedded in a copy-pasteable shell
// command. Bare when it's already shell-safe; otherwise wrap in single quotes
// and escape any embedded single quote as '\''.
export function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
