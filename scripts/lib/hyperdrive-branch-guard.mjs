// @ts-check
// Migrations run against DATABASE_URL_MIGRATIONS_* (platform_admin, direct Neon
// connection). The Workers read through a Hyperdrive binding whose origin is set
// independently. Nothing ties the two together, so a migration URL pointing at one
// Neon branch while Hyperdrive points at another means migrations silently land on a
// database the runtime never reads. This guard resolves both Neon endpoint ids and
// refuses to migrate when they diverge.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Neon distinguishes branches by their compute endpoint id (`ep-<slug>`). Pooled and
 * direct hosts for the same branch share that id and differ only by a `-pooler`
 * infix, so normalizing it away lets a pooled Hyperdrive origin compare equal to a
 * direct migration URL on the same branch.
 *
 * @param {string} host
 * @returns {string | null}
 */
export function neonEndpointId(host) {
  if (!host) {
    return null;
  }
  const label = host.split(".")[0] ?? "";
  const match = label.match(/^(ep-[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-pooler)?$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {string} uri
 * @returns {string | null}
 */
export function endpointIdFromConnectionUri(uri) {
  try {
    return neonEndpointId(new URL(uri).host);
  } catch {
    return null;
  }
}

/**
 * Compare the migration target's endpoint id against the Hyperdrive origin's.
 * Returns a structured verdict instead of throwing so callers (and tests) can
 * decide how loud to be.
 *
 * @param {{ migrationEndpointId: string | null, hyperdriveEndpointId: string | null, target: string }} input
 */
export function evaluateBranchDivergence({ migrationEndpointId, hyperdriveEndpointId, target }) {
  if (!migrationEndpointId || !hyperdriveEndpointId) {
    return {
      ok: false,
      reason: "unresolved",
      message:
        `Could not resolve both Neon endpoints for ${target} ` +
        `(migration=${migrationEndpointId ?? "<none>"}, hyperdrive=${hyperdriveEndpointId ?? "<none>"}). ` +
        "Refusing to migrate against an unverified branch.",
    };
  }
  if (migrationEndpointId !== hyperdriveEndpointId) {
    return {
      ok: false,
      reason: "divergent",
      message:
        `Neon branch divergence for ${target}: migrations target ${migrationEndpointId} but the ` +
        `Hyperdrive binding reads ${hyperdriveEndpointId}. Migrations would land on a database the ` +
        "Workers never read. Point DATABASE_URL_MIGRATIONS_" +
        target.toUpperCase() +
        " at the same Neon branch as the Hyperdrive origin (or repoint Hyperdrive), then retry.",
    };
  }
  return { ok: true, reason: "match", endpointId: migrationEndpointId };
}

/**
 * Read the Hyperdrive binding id for an env out of a wrangler JSONC config.
 *
 * @param {string} configText
 * @param {string} env
 * @param {string} [binding]
 * @returns {string | null}
 */
export function hyperdriveIdFromWranglerConfig(configText, env, binding = "DB") {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonComments(configText));
  } catch {
    return null;
  }
  const bindings = parsed?.env?.[env]?.hyperdrive;
  if (!Array.isArray(bindings)) {
    return null;
  }
  const entry = bindings.find((item) => item?.binding === binding) ?? bindings[0];
  return entry?.id ?? null;
}

/**
 * @param {string} stdout `wrangler hyperdrive get` JSON output
 * @returns {string | null}
 */
export function hyperdriveOriginEndpointId(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1) {
    return null;
  }
  try {
    const config = JSON.parse(stdout.slice(start, end + 1));
    return neonEndpointId(config?.origin?.host ?? "");
  } catch {
    return null;
  }
}

/**
 * Run the full guard against the live wrangler config + Hyperdrive API.
 * Throws when the migration target and Hyperdrive origin point at different
 * Neon branches.
 *
 * @param {{
 *   target: "preview" | "production",
 *   migrationUrl: string,
 *   wranglerConfigPath?: string,
 *   configText?: string,
 *   runWrangler?: (args: string[]) => Promise<string>,
 *   log?: (message: string) => void,
 * }} input
 */
export async function assertMigrationBranchMatchesHyperdrive({
  target,
  migrationUrl,
  wranglerConfigPath = "apps/api/wrangler.jsonc",
  configText,
  runWrangler = defaultRunWrangler,
  log = (message) => process.stdout.write(`${message}\n`),
}) {
  const resolvedConfig = configText ?? readFileSync(wranglerConfigPath, "utf8");
  const hyperdriveId = hyperdriveIdFromWranglerConfig(resolvedConfig, target);
  if (!hyperdriveId) {
    throw new Error(
      `Could not find a Hyperdrive binding for env "${target}" in ${configText ? "the provided config" : wranglerConfigPath}. ` +
        "The migration branch guard cannot verify the target branch.",
    );
  }

  const stdout = await runWrangler(["hyperdrive", "get", hyperdriveId]);
  const verdict = evaluateBranchDivergence({
    migrationEndpointId: endpointIdFromConnectionUri(migrationUrl),
    hyperdriveEndpointId: hyperdriveOriginEndpointId(stdout),
    target,
  });

  if (!verdict.ok) {
    throw new Error(verdict.message);
  }
  log(`Neon branch guard: ${target} migrations and Hyperdrive both target ${verdict.endpointId}.`);
}

/**
 * @param {string} text
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: char-by-char JSON-comment-stripping state machine; the branches are the states and splitting them obscures the scanner. See docs/ops/complexity-todo.md.
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function defaultRunWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`wrangler ${args.slice(0, 2).join(" ")} exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}
