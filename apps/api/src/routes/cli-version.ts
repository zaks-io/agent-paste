import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";

// `GET /v1/public/cli-version` advertises the latest and minimum-supported CLI
// versions (ADR 0080). The value is a single JSON blob in the CLI_RELEASE KV
// namespace, written by the release pipeline (phase 4). Until it is seeded the
// handler serves a silent default: 0.0.0 is below every real version, so the
// CLI never nags and never force-warns against an unconfigured endpoint.
//
// The read path is CF edge cache first (Cache-Control below), then this
// module-scope memo so an edge miss hits KV at most once per TTL per isolate.

type CliRelease = { latest: string; min_supported: string };

const KV_KEY = "cli-release";
const SAFE_DEFAULT: CliRelease = { latest: "0.0.0", min_supported: "0.0.0" };
const MEMO_TTL_MS = 60_000;
const CACHE_CONTROL = "public, max-age=300";

let memo: { value: CliRelease; expiresAt: number } | null = null;

// Test-only: drop the module memo so cases can assert the KV read in isolation.
export function __resetCliVersionMemo(): void {
  memo = null;
}

function parseRelease(raw: string | null): CliRelease {
  if (!raw) {
    return SAFE_DEFAULT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CliRelease>;
    if (typeof parsed?.latest === "string" && typeof parsed?.min_supported === "string") {
      return { latest: parsed.latest, min_supported: parsed.min_supported };
    }
  } catch {
    // Malformed KV value falls through to the safe default; never 500.
  }
  return SAFE_DEFAULT;
}

async function readRelease(context: AppContext): Promise<CliRelease> {
  if (!context.env.CLI_RELEASE?.get) {
    return SAFE_DEFAULT;
  }
  try {
    return parseRelease(await context.env.CLI_RELEASE.get(KV_KEY));
  } catch {
    // A transient KV failure must not 500 this public read; serve the default.
    return SAFE_DEFAULT;
  }
}

export async function getCliVersion(context: AppContext): Promise<Response> {
  const responders = getBoundResponders(context);
  const now = Date.now();
  if (memo && memo.expiresAt > now) {
    return responders.respondJson(memo.value, 200, { "cache-control": CACHE_CONTROL });
  }
  const value = await readRelease(context);
  memo = { value, expiresAt: now + MEMO_TTL_MS };
  return responders.respondJson(value, 200, { "cache-control": CACHE_CONTROL });
}
