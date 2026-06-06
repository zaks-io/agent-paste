import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveApiBaseUrl } from "@agent-paste/api-client";
import { CliVersionResponse } from "@agent-paste/contracts";
import { configDir, ensureConfigDir } from "./credentials.js";
import { type Channel, detectChannel, upgradeCommand } from "./update-check.js";

// `agent-paste upgrade` (ADR 0080 §5): a standalone binary install downloads the
// matching release asset from the GitHub Release, verifies it against
// SHA256SUMS, and atomically replaces itself in place. Always explicit, never
// silent. npm/npx installs are redirected to their own updater — this never
// touches the filesystem off the binary channel.

const REPO = "zaks-io/agent-paste";
const RELEASE_BASE = `https://github.com/${REPO}/releases/download`;
const DOWNLOAD_TIMEOUT_MS = 30_000;

// A release tag is exactly `cli-v<semver-core>` (optional -prerelease/+build).
// Validating before the tag is interpolated into the release URL is a security
// boundary, not a nicety: an unvalidated tag with `../` segments would be
// path-normalized by the URL parser into a different GitHub repo, and since the
// asset AND its SHA256SUMS would both come from that attacker-controlled base,
// the checksum check would pass against the attacker's own sums — silent RCE.
const RELEASE_TAG = /^cli-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function assertReleaseTag(tag: string): string {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(`invalid release tag: ${tag} (expected cli-v<major>.<minor>.<patch>)`);
  }
  return tag;
}

// OS/arch → published asset name. Ported from the install scripts
// (apps/apex/src/install-sh.ts, install-ps1.ts), which are sh/PowerShell string
// constants and cannot be imported; a parity test asserts these strings still
// appear verbatim in both so the three sources cannot drift.
const ASSETS: Record<string, string> = {
  "darwin-arm64": "agent-paste-darwin-arm64",
  "linux-x64": "agent-paste-linux-x64",
  "linux-arm64": "agent-paste-linux-arm64",
  "win32-x64": "agent-paste-windows-x64.exe",
};

// node's process.arch reports x64/arm64; normalize the odd synonyms the
// installers also accept so a host string maps to the same arch token.
function normalizeArch(arch: string): string {
  if (arch === "x86_64" || arch === "amd64") return "x64";
  if (arch === "aarch64") return "arm64";
  return arch;
}

export function assetNameFor(platform: string, arch: string): string {
  const asset = ASSETS[`${platform}-${normalizeArch(arch)}`];
  if (!asset) {
    throw new Error(`no prebuilt binary for ${platform}-${arch}. See https://github.com/${REPO}/releases`);
  }
  return asset;
}

// A SHA256SUMS line is "<hash>  <file>" (text) or "<hash> *<file>" (binary).
// Anchor on the exact filename so agent-paste-linux-x64 never matches a longer
// name. Returns the lowercased hash, or null when the asset is not listed.
export function parseSha256Sums(text: string, asset: string): string | null {
  for (const line of text.split("\n")) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2]?.trim() === asset) {
      return match[1]?.toLowerCase() ?? null;
    }
  }
  return null;
}

// Carries the verified temp path so the caller can print a one-line manual
// completion when the in-place swap hits a true permission wall.
export class UpgradePermissionError extends Error {
  constructor(
    message: string,
    readonly stagedPath: string,
    readonly targetPath: string,
  ) {
    super(message);
    this.name = "UpgradePermissionError";
  }
}

// The fs/crypto shims operate on Uint8Array<ArrayBuffer>; keep one alias so the
// downloaded bytes flow straight into writeFile/createHash without re-narrowing.
type Bytes = Uint8Array<ArrayBuffer>;
type FetchBytes = (url: string) => Promise<Bytes>;
type FetchText = (url: string) => Promise<string>;
type WriteOutput = (message: string) => void;

type FsOps = {
  stat: typeof fs.stat;
  writeFile: typeof fs.writeFile;
  chmod: typeof fs.chmod;
  rename: typeof fs.rename;
  rm: typeof fs.rm;
  mkdir: typeof fs.mkdir;
};

export type UpgradeDeps = {
  channel?: Channel;
  platform?: string;
  arch?: string;
  binaryPath?: string;
  baseUrl?: string;
  resolveLatest?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  fetchBytes?: FetchBytes;
  fetchText?: FetchText;
  fsOps?: FsOps;
  rand?: () => string;
  rescueStage?: (bytes: Bytes, mode: number) => Promise<string>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

type UpgradePlan = {
  tag: string;
  asset: string;
  releaseBase: string;
  binaryPath: string;
  fetchBytes: FetchBytes;
  fetchText: FetchText;
  ops: FsOps;
  rand: () => string;
  rescueStage: (bytes: Bytes, mode: number) => Promise<string>;
};

// When the install dir is unwritable, stage the verified bytes in the config dir
// (created 0o700 like the credential store) so the manual `sudo mv` has a real
// source. Returns the absolute path of the staged file.
async function defaultRescueStage(ops: FsOps, rand: () => string, bytes: Bytes, mode: number): Promise<string> {
  await ensureConfigDir();
  const staged = path.join(configDir(), `agent-paste-upgrade-${rand()}`);
  await ops.writeFile(staged, bytes, { mode });
  await ops.chmod(staged, mode);
  return staged;
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EROFS";
}

async function defaultResolveLatest(baseUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${baseUrl}/v1/public/cli-version`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`failed to resolve latest version (HTTP ${response.status})`);
  }
  const parsed = CliVersionResponse.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("version endpoint returned an unexpected payload");
  }
  return parsed.data.latest;
}

function httpsOnly(url: string): void {
  if (!url.startsWith("https://")) {
    throw new Error(`refusing non-https download: ${url}`);
  }
}

function defaultFetchBytes(fetchImpl: typeof fetch): FetchBytes {
  return async (url) => {
    httpsOnly(url);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`download failed (HTTP ${response.status}): ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer()) as Bytes;
  };
}

function defaultFetchText(fetchImpl: typeof fetch): FetchText {
  return async (url) => {
    httpsOnly(url);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`download failed (HTTP ${response.status}): ${url}`);
    }
    return response.text();
  };
}

// Swap the running binary for `bytes`. The temp file lives in the target's own
// directory so the final rename is intra-directory (no EXDEV). The rename-aside
// dance — move current → .old, move new → target, drop .old — is what lets a
// running executable be replaced on Windows and on ETXTBSY-strict Linux.
//
// A true permission wall (a sudo'd install dir the current user can't write) is
// the one unrecoverable-in-process case. The install dir itself is unwritable,
// so the bytes are re-staged in a guaranteed-writable rescue location (the
// config dir) and the error carries THAT path — the manual `sudo mv` hint must
// point at a file that exists, not at a stage that could never be written.
async function replaceBinary(
  target: string,
  bytes: Bytes,
  ops: FsOps,
  rand: () => string,
  rescue: (mode: number) => Promise<string>,
): Promise<void> {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const staged = path.join(dir, `${base}.new-${rand()}`);
  const mode = await currentMode(target, ops);

  try {
    await ops.writeFile(staged, bytes, { mode });
    await ops.chmod(staged, mode);
  } catch (error) {
    if (isPermissionError(error)) {
      throw await permissionWall(`cannot write to ${dir}: the install directory is not writable`, target, () =>
        rescue(mode),
      );
    }
    throw error;
  }

  const aside = path.join(dir, `${base}.old-${rand()}`);
  try {
    await ops.rename(target, aside);
  } catch (error) {
    await safeRm(staged, ops);
    if (isPermissionError(error)) {
      throw await permissionWall(`cannot replace ${target}: the install directory is not writable`, target, () =>
        rescue(mode),
      );
    }
    throw error;
  }

  try {
    await ops.rename(staged, target);
  } catch (error) {
    // Put the original back so a failed swap never leaves the user with no binary,
    // and drop the now-orphaned staged file.
    await ops.rename(aside, target).catch(() => {});
    await safeRm(staged, ops);
    throw error;
  }
  await safeRm(aside, ops);
}

async function permissionWall(message: string, target: string, rescue: () => Promise<string>): Promise<Error> {
  try {
    return new UpgradePermissionError(message, await rescue(), target);
  } catch (rescueError) {
    // Even the rescue dir is unwritable — report plainly rather than a dead hint.
    const detail = rescueError instanceof Error ? rescueError.message : String(rescueError);
    return new Error(`${message}; could not stage the verified binary for manual install: ${detail}`);
  }
}

async function currentMode(target: string, ops: FsOps): Promise<number> {
  try {
    return (await ops.stat(target)).mode & 0o777;
  } catch {
    return 0o755;
  }
}

async function safeRm(file: string, ops: FsOps): Promise<void> {
  await ops.rm(file, { force: true }).catch(() => {});
}

function upgradeOutput(deps: UpgradeDeps): { stdout: WriteOutput; stderr: WriteOutput } {
  return {
    stdout: deps.stdout ?? ((message: string) => void process.stdout.write(message)),
    stderr: deps.stderr ?? ((message: string) => void process.stderr.write(message)),
  };
}

function redirectNonBinaryChannel(channel: Channel, stderr: WriteOutput): boolean {
  if (channel === "binary") return false;

  const command = upgradeCommand(channel);
  stderr(
    command
      ? `agent-paste upgrade is for standalone binary installs. Run: ${command}\n`
      : "agent-paste upgrade is for standalone binary installs. npx always runs the latest version.\n",
  );
  process.exitCode = 1;
  return true;
}

async function createUpgradePlan(opts: { version?: string }, deps: UpgradeDeps): Promise<UpgradePlan> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl ?? resolveApiBaseUrl();
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const binaryPath = deps.binaryPath ?? process.execPath;
  const ops = deps.fsOps ?? fs;
  const rand = deps.rand ?? (() => Buffer.from(randomBytes(6)).toString("hex"));

  const tag = await resolveReleaseTag(opts, deps, baseUrl, fetchImpl);
  const asset = assetNameFor(platform, arch);
  const rescueStage = deps.rescueStage ?? ((bytes: Bytes, mode: number) => defaultRescueStage(ops, rand, bytes, mode));

  return {
    tag,
    asset,
    releaseBase: `${RELEASE_BASE}/${tag}`,
    binaryPath,
    fetchBytes: deps.fetchBytes ?? defaultFetchBytes(fetchImpl),
    fetchText: deps.fetchText ?? defaultFetchText(fetchImpl),
    ops,
    rand,
    rescueStage,
  };
}

async function resolveReleaseTag(
  opts: { version?: string },
  deps: UpgradeDeps,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const resolveLatest = deps.resolveLatest ?? (() => defaultResolveLatest(baseUrl, fetchImpl));
  // A pinned --version is the full release tag (cli-vX.Y.Z); otherwise resolve
  // latest and build the tag, so the bytes and SHA256SUMS come from one exact
  // release. Validate the tag before it reaches the URL (see RELEASE_TAG).
  const tag = opts.version ?? `cli-v${await resolveLatest()}`;
  return assertReleaseTag(tag);
}

async function downloadVerifiedAsset(plan: UpgradePlan): Promise<Bytes> {
  const bytes = await plan.fetchBytes(`${plan.releaseBase}/${plan.asset}`);
  const sums = await plan.fetchText(`${plan.releaseBase}/SHA256SUMS`);
  const want = parseSha256Sums(sums, plan.asset);

  if (!want) {
    throw new Error(`no checksum for ${plan.asset} in SHA256SUMS`);
  }

  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) {
    throw new Error(`checksum mismatch for ${plan.asset}: expected ${want}, got ${got}`);
  }

  return bytes;
}

async function replaceBinaryOrReportPermission(plan: UpgradePlan, bytes: Bytes, stderr: WriteOutput): Promise<boolean> {
  try {
    await replaceBinary(plan.binaryPath, bytes, plan.ops, plan.rand, (mode) => plan.rescueStage(bytes, mode));
    return true;
  } catch (error) {
    if (error instanceof UpgradePermissionError) {
      reportPermissionWall(error, stderr);
      return false;
    }
    throw error;
  }
}

function reportPermissionWall(error: UpgradePermissionError, stderr: WriteOutput): void {
  stderr(
    `${error.message}\n` +
      `The verified new binary is staged at:\n  ${error.stagedPath}\n` +
      `Finish the upgrade with:\n  sudo mv ${error.stagedPath} ${error.targetPath}\n`,
  );
  process.exitCode = 1;
}

export async function runUpgrade(opts: { version?: string } = {}, deps: UpgradeDeps = {}): Promise<void> {
  const { stdout, stderr } = upgradeOutput(deps);
  const channel = deps.channel ?? detectChannel();

  if (redirectNonBinaryChannel(channel, stderr)) return;

  const plan = await createUpgradePlan(opts, deps);
  stdout(`Downloading ${plan.asset} (${plan.tag})...\n`);

  const bytes = await downloadVerifiedAsset(plan);
  const replaced = await replaceBinaryOrReportPermission(plan, bytes, stderr);
  if (!replaced) return;

  stdout(`Upgraded agent-paste to ${plan.tag}.\n`);
}
