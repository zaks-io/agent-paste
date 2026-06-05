// Resolves secret VALUES for a deploy target from the process environment, per
// ADR 0078. At deploy time the environment the deploy runs in (GitHub environment
// secrets in CI) is the source of truth for any provider-issued or externally
// managed value. This module only reads; it never generates. Generation of
// symmetric secrets lives in scripts/deploy.mjs (generate-if-missing).
//
// Convention: a secret named SECRET_NAME for environment <env> is read from the
// env var `<ENV_PREFIX>_<SECRET_NAME>`, e.g. PRODUCTION_CONTENT_SIGNING_SECRET,
// PREVIEW_API_KEY_PEPPER_V1. A bare `SECRET_NAME` is accepted as a fallback so a
// local operator can export the unprefixed value for an ad-hoc deploy.

/** @param {"preview"|"production"} env */
export function envPrefix(env) {
  // Guard against a typo silently resolving to PREVIEW and reading the wrong
  // environment's secrets — exactly the kind of routing bug this module exists
  // to prevent. deploy.mjs validates the target too, but this is the unit boundary.
  if (env !== "preview" && env !== "production") {
    throw new Error(`Invalid environment: ${env}. Must be "preview" or "production".`);
  }
  return env === "production" ? "PRODUCTION" : "PREVIEW";
}

/**
 * Resolve the value for one secret name in an environment from process.env.
 * Returns the env-prefixed value if present, else the bare name, else undefined.
 *
 * An empty (or whitespace-only) value is treated as unset: a GitHub `${{ secrets.X }}`
 * reference to a secret that does not exist injects an empty string, not nothing, so a
 * deploy must read "" as "leave the Worker's existing value alone" rather than provision
 * a blank/generated value over it. The empty env-prefixed value falls through to the bare
 * name for the same reason.
 * @param {string} name
 * @param {"preview"|"production"} env
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {string|undefined}
 */
export function resolveSecretValue(name, env, source = process.env) {
  return firstNonEmpty(source[`${envPrefix(env)}_${name}`], source[name]);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}
