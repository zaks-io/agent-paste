import { promises as fs } from "node:fs";
import { resolveApiBaseUrl } from "@agent-paste/api-client";
import { CliVersionResponse } from "@agent-paste/contracts";
import { ensureConfigDir, updateCheckCachePath } from "./credentials.js";
import type { GlobalFlags } from "./index.js";
import { CLI_VERSION } from "./version.js";

// Background staleness check (ADR 0080 §3). Runs after a real command, prints at
// most one channel-tailored hint to stderr, and fails open: any network, parse,
// or filesystem error is swallowed so the command's own result is never touched.

const FETCH_TIMEOUT_MS = 3_000;
const THROTTLE_MS = 24 * 60 * 60 * 1_000;
const PACKAGE = "@zaks-io/agent-paste";

export type Channel = "npx" | "npm-global" | "binary" | "unknown";

type Cache = { lastCheckAt: string; latest?: string; min_supported?: string };

type Deps = {
  channel?: Channel;
  env?: Record<string, string | undefined>;
  now?: Date;
  isTty?: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  readCache?: () => Promise<Cache | null>;
  writeCache?: (cache: Cache) => Promise<void>;
  stderr?: (message: string) => void;
};

// Strip a leading `v` and any `-prerelease`/`+build` suffix, then compare the
// numeric major.minor.patch triples. A dev sentinel ("0.0.0-dev") collapses to
// "0.0.0", which is below any real release.
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) =>
    (v.trim().replace(/^v/, "").split(/[-+]/, 1)[0] ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

export function detectChannel(
  env: Record<string, string | undefined> = process.env,
  argv1: string = process.argv[1] ?? "",
  execPath: string = process.execPath,
): Channel {
  const userAgent = env.npm_config_user_agent ?? "";
  const execpath = env.npm_execpath ?? "";
  const npxLike = userAgent.includes("npx") || /[/\\]_npx[/\\]/.test(execpath) || /[/\\]_npx[/\\]/.test(argv1);
  if (npxLike) return "npx";
  // A bun-compiled single-file binary IS its own runtime: the entrypoint and the
  // executable are the same path. This is the only reliable binary signal — an
  // npm-global install ships an extensionless shim, but runs under Node, so its
  // execPath is the `node` binary and never equals argv1.
  if (argv1 && argv1 === execPath) return "binary";
  if (userAgent || execpath || /[/\\]node_modules[/\\]/.test(argv1) || /\.(c|m)?js$/.test(argv1)) return "npm-global";
  return "unknown";
}

function shouldCheck(deps: Deps, global: GlobalFlags, cache: Cache | null): boolean {
  const env = deps.env ?? process.env;
  if (env.AGENT_PASTE_NO_UPDATE_CHECK || env.CI) return false;
  const isTty = deps.isTty ?? Boolean(process.stdout.isTTY);
  if (!isTty || global.json || global.quiet) return false;
  if (cache?.lastCheckAt) {
    const age = (deps.now ?? new Date()).getTime() - Date.parse(cache.lastCheckAt);
    if (Number.isFinite(age) && age >= 0 && age < THROTTLE_MS) return false;
  }
  return true;
}

async function readCacheFile(): Promise<Cache | null> {
  try {
    const raw = await fs.readFile(updateCheckCachePath(), "utf8");
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

async function writeCacheFile(cache: Cache): Promise<void> {
  await ensureConfigDir();
  const file = updateCheckCachePath();
  await fs.writeFile(file, `${JSON.stringify(cache, null, 2)}\n`);
}

// The channel-correct command to get current. Only a confirmed standalone binary
// can self-upgrade; under Node (npm-global/unknown) the npm command is the safe
// suggestion over a dead `upgrade`. npx always runs latest, so there is nothing
// to run. Shared by the staleness nag and the `upgrade` command's redirect.
export function upgradeCommand(channel: Channel): string | null {
  if (channel === "npx") return null;
  return channel === "binary" ? "agent-paste upgrade" : `npm i -g ${PACKAGE}@latest`;
}

function nag(channel: Channel, latest: string): string | null {
  const command = upgradeCommand(channel);
  return command ? `Update available: ${latest}. Run: ${command}` : null;
}

// Pure decision: given the installed version, the server's version data, and the
// channel, return the single line to print on stderr (without trailing newline),
// or null when nothing is stale. Below-minimum wins over a plain update nag.
export function decideUpdateMessage(
  current: string,
  versions: { latest: string; min_supported: string },
  channel: Channel,
): string | null {
  if (compareSemver(current, versions.min_supported) < 0) {
    const command = upgradeCommand(channel);
    const suffix = command ? `Upgrade soon: ${command}` : "Upgrade soon.";
    return `Your agent-paste ${current} is below the minimum supported ${versions.min_supported}. ${suffix}`;
  }
  if (compareSemver(current, versions.latest) < 0) {
    return nag(channel, versions.latest);
  }
  return null;
}

export async function runUpdateCheck(global: GlobalFlags, deps: Deps = {}): Promise<void> {
  try {
    const readCache = deps.readCache ?? readCacheFile;
    const cache = await readCache();
    if (!shouldCheck(deps, global, cache)) return;

    // Stamp the timestamp before the network call so a failed or offline check
    // still throttles for 24h, rather than re-blocking on every command.
    const writeCache = deps.writeCache ?? writeCacheFile;
    const checkedAt = (deps.now ?? new Date()).toISOString();
    await writeCache({ lastCheckAt: checkedAt });

    const base = deps.baseUrl ?? resolveApiBaseUrl();
    const response = await (deps.fetchImpl ?? fetch)(`${base}/v1/public/cli-version`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return;
    const parsed = CliVersionResponse.safeParse(await response.json());
    if (!parsed.success) return;
    const { latest, min_supported } = parsed.data;
    await writeCache({ lastCheckAt: checkedAt, latest, min_supported });

    const write = deps.stderr ?? ((message: string) => void process.stderr.write(message));
    const channel = deps.channel ?? detectChannel();
    const message = decideUpdateMessage(CLI_VERSION, { latest, min_supported }, channel);
    if (message) write(`${message}\n`);
  } catch {
    // Fail open: a stale-check must never affect the command's outcome.
  }
}
