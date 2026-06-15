// @ts-check

/**
 * Evaluate a `pnpm audit --json` report against a severity threshold.
 *
 * pnpm's own exit code cannot be trusted when `auditConfig.ignoreGhsas` is
 * set: pnpm filters ignored advisories out of `advisories` but computes the
 * exit code from `metadata.vulnerabilities`, which still counts them
 * (pnpm 10.19). This evaluates the post-ignore `advisories` list instead.
 *
 * @param {string} reportJsonText raw stdout of `pnpm audit --json`
 * @param {{ blockedSeverities?: string[], allowedFindings?: Array<{ ghsa: string, module?: string, paths: string[], reason: string }> }} [options]
 * @returns {{ status: number, blockedSeverities: string[], advisoryCount: number, blocking: Array<{ id: string, ghsa: string | null, module: string, severity: string, title: string }>, allowed: Array<{ id: string, ghsa: string | null, module: string, severity: string, title: string, paths: string[], reason: string }> }}
 */
export function evaluatePnpmAuditPolicy(reportJsonText, options = {}) {
  const blockedSeverities = options.blockedSeverities ?? ["moderate", "high", "critical"];
  const allowedFindings = options.allowedFindings ?? [];
  /** @type {{ advisories?: Record<string, { github_advisory_id?: string, url?: string, module_name?: string, severity?: string, title?: string, findings?: Array<{ paths?: string[] }> }> }} */
  let report;
  try {
    report = JSON.parse(reportJsonText);
  } catch {
    throw new Error("pnpm audit output is not valid JSON; failing closed");
  }
  if (
    typeof report !== "object" ||
    report === null ||
    typeof report.advisories !== "object" ||
    report.advisories === null ||
    Array.isArray(report.advisories)
  ) {
    throw new Error("pnpm audit output has no advisories object; failing closed");
  }
  const advisories = Object.entries(report.advisories ?? {});
  const blocking = [];
  const allowed = [];
  for (const [id, advisory] of advisories) {
    if (!blockedSeverities.includes(advisory.severity ?? "")) {
      continue;
    }
    const base = {
      id,
      ghsa: ghsaFor(advisory),
      module: advisory.module_name ?? "unknown",
      severity: advisory.severity ?? "unknown",
      title: advisory.title ?? "unknown",
    };
    const allowedFinding = allowedFindingFor(advisory, allowedFindings);
    if (allowedFinding) {
      allowed.push({ ...base, paths: allowedFinding.paths, reason: allowedFinding.reason });
    } else {
      blocking.push(base);
    }
  }
  return {
    status: blocking.length === 0 ? 0 : 1,
    blockedSeverities,
    advisoryCount: advisories.length,
    blocking,
    allowed,
  };
}

function ghsaFor(advisory) {
  if (advisory.github_advisory_id) {
    return advisory.github_advisory_id;
  }
  const match = advisory.url?.match(/GHSA-[a-z0-9-]+/i);
  return match?.[0] ?? null;
}

function allowedFindingFor(advisory, allowedFindings) {
  const ghsa = ghsaFor(advisory);
  const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []);
  if (!ghsa || paths.length === 0) {
    return null;
  }
  const allowed = allowedFindings.find(
    (finding) => finding.ghsa === ghsa && (!finding.module || finding.module === advisory.module_name),
  );
  if (!allowed) {
    return null;
  }
  const allowedPaths = new Set(allowed.paths);
  return paths.every((path) => allowedPaths.has(path)) ? { paths, reason: allowed.reason } : null;
}
