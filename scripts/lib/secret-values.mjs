// @ts-check
// Resolves secret VALUES for a deploy target from the process environment, per
// ADR 0078. At deploy time the environment the deploy runs in (GitHub environment
// secrets in CI) is the source of truth for any provider-issued or externally
// managed value. This module only reads; it never generates. Generation of
// symmetric secrets lives in scripts/deploy.mjs (generate-if-missing).
//
// GitHub Environment selection owns environment scope. Process variable names
// stay identical to Worker binding names so one secret has one name.

/**
 * Resolve the value for one secret name in an environment from process.env.
 * Returns the canonical value when present, else undefined.
 *
 * An empty (or whitespace-only) value is treated as unset: a GitHub `${{ secrets.X }}`
 * reference to a secret that does not exist injects an empty string, not nothing, so a
 * deploy must read "" as "leave the Worker's existing value alone" rather than provision
 * a blank/generated value over it.
 * @param {string} name
 * @param {"preview"|"production"} env
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {string|undefined}
 */
export function resolveSecretValue(name, env, source = process.env) {
  if (env !== "preview" && env !== "production") {
    throw new Error(`Invalid environment: ${env}. Must be "preview" or "production".`);
  }
  return firstNonEmpty(source[name]);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}
