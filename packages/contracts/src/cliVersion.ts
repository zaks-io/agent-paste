import { z } from "./zod.js";

// `major.minor.patch` with optional `-prerelease`/`+build` (semver core). The
// CLI compares these to its baked-in version, so a non-version string (e.g. a
// fat-fingered KV value) is a contract violation, not a 0-length one — reject it
// here rather than let it reach the comparison logic.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Advertised CLI release versions served by `GET /v1/public/cli-version` (ADR
// 0080). `min_supported` is the floor below which a louder upgrade warning
// fires.
export const CliVersionResponse = z.object({
  latest: z.string().regex(SEMVER),
  min_supported: z.string().regex(SEMVER),
});
export type CliVersionResponse = z.infer<typeof CliVersionResponse>;
