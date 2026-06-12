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
 * @param {{ blockedSeverities?: string[] }} [options]
 * @returns {{ status: number, blockedSeverities: string[], advisoryCount: number, blocking: Array<{ id: string, ghsa: string | null, module: string, severity: string, title: string }> }}
 */
export function evaluatePnpmAuditPolicy(reportJsonText, options = {}) {
  const blockedSeverities = options.blockedSeverities ?? ["moderate", "high", "critical"];
  /** @type {{ advisories?: Record<string, { github_advisory_id?: string, module_name?: string, severity?: string, title?: string }> }} */
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
  const blocking = advisories
    .filter(([, advisory]) => blockedSeverities.includes(advisory.severity ?? ""))
    .map(([id, advisory]) => ({
      id,
      ghsa: advisory.github_advisory_id ?? null,
      module: advisory.module_name ?? "unknown",
      severity: advisory.severity ?? "unknown",
      title: advisory.title ?? "unknown",
    }));
  return {
    status: blocking.length === 0 ? 0 : 1,
    blockedSeverities,
    advisoryCount: advisories.length,
    blocking,
  };
}
