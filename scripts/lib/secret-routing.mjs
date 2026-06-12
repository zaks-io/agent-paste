// @ts-check
// Single source of truth for which Worker consumes which secret, per ADR 0078.
//
// Every deploy path (standing preview/production in deploy.mjs, per-PR in
// deploy-pr-preview.mjs) and the first-deploy generator (bootstrap-secrets.mjs)
// reads routing from here. The same data drives each Worker's `secrets.required`
// in wrangler.jsonc, so the declaration in config and the values written at deploy
// can never disagree.
//
// `required: true`  -> the Worker cannot serve a request without it; listed in
//                      `secrets.required` and a missing value fails the deploy.
// `required: false` -> consumed when present (rotation overlap, optional feature,
//                      or env-scoped) but absent is tolerated; NOT in secrets.required.

/**
 * @typedef {Object} SecretBinding
 * @property {boolean} required Whether the consuming Worker hard-requires the secret.
 * @property {"all"|"production"|"preview"} [envs] Environment scope (default: all).
 * @property {"symmetric"|"workos"|"stripe"} [source] Where the value originates. `workos`
 *   and `stripe` values come from their provider console / GitHub env, not the symmetric
 *   generator.
 */

/**
 * App -> secret name -> binding metadata.
 * Apps not listed (apex, stream-without-secrets) take no secrets.
 * @type {Record<string, Record<string, SecretBinding>>}
 */
export const SECRET_ROUTING = {
  api: {
    CONTENT_SIGNING_SECRET: { required: true },
    ARTIFACT_BYTES_ENCRYPTION_KEY: { required: true },
    API_KEY_PEPPER_V1: { required: true },
    API_KEY_PEPPER_V2: { required: false }, // rotation overlap window (ADR 0045)
    ACCESS_LINK_SIGNING_KEY_V1: { required: true }, // signs Share/Revision Link URLs (ADR 0047); mint 503s without it
    ACCESS_LINK_SIGNING_KEY_V2: { required: false }, // rotation overlap window
    SMOKE_HARNESS_SECRET: { required: false, envs: "preview" }, // non-production only
    EPHEMERAL_POW_SECRET: { required: true },
    STREAM_INTERNAL_SECRET: { required: true },
    WORKOS_API_KEY: { required: true, source: "workos" }, // MCP bearer verification (mcpVerifyOptions) returns null without it
    CF_ACCESS_AUD: { required: false, envs: "production", source: "workos" },
    // Stripe billing (ADR 0073/0074). All optional: billing is off-by-default
    // behind BILLING_ENABLED, so a deploy without Stripe configured must succeed
    // and the routes 404. Written when a value is present in the environment.
    STRIPE_SECRET_KEY: { required: false, source: "stripe" },
    STRIPE_WEBHOOK_SIGNING_SECRET: { required: false, source: "stripe" },
    STRIPE_PRICE_ID_MONTHLY: { required: false, source: "stripe" },
    STRIPE_PRICE_ID_ANNUAL: { required: false, source: "stripe" },
  },
  upload: {
    CONTENT_SIGNING_SECRET: { required: true },
    UPLOAD_SIGNING_SECRET: { required: true },
    API_KEY_PEPPER_V1: { required: true },
    API_KEY_PEPPER_V2: { required: false },
    ARTIFACT_BYTES_ENCRYPTION_KEY: { required: true },
    WORKOS_API_KEY: { required: true, source: "workos" }, // MCP bearer verification on forwarded upload-session calls
  },
  content: {
    CONTENT_SIGNING_SECRET: { required: true },
    ARTIFACT_BYTES_ENCRYPTION_KEY: { required: true },
  },
  jobs: {
    CONTENT_SIGNING_SECRET: { required: true },
    ARTIFACT_BYTES_ENCRYPTION_KEY: { required: true },
    SMOKE_HARNESS_SECRET: { required: false, envs: "preview" },
  },
  stream: {
    STREAM_INTERNAL_SECRET: { required: true },
  },
  mcp: {
    WORKOS_API_KEY: { required: true, source: "workos" }, // MCP bearer verification at the edge gate
  },
  web: {
    WORKOS_API_KEY: { required: true, source: "workos" },
    WORKOS_COOKIE_PASSWORD: { required: true, source: "workos" },
  },
};

export const FORBIDDEN_SECRET_ROUTING = {
  production: {
    api: ["SMOKE_HARNESS_SECRET"],
    jobs: ["SMOKE_HARNESS_SECRET"],
  },
};

/** Apps that take at least one secret. */
export function secretConsumingApps() {
  return Object.keys(SECRET_ROUTING);
}

/**
 * Secret names that must not be bound for an app in a given environment.
 * @param {string} app
 * @param {"preview"|"production"} env
 * @returns {string[]}
 */
export function forbiddenSecretsForApp(app, env) {
  return FORBIDDEN_SECRET_ROUTING[env]?.[app] ?? [];
}

/**
 * @param {Array<{ worker: string, name: string }>} forbiddenSecrets
 */
export function formatForbiddenSecretDeleteInstructions(forbiddenSecrets) {
  return forbiddenSecrets
    .map(
      (entry) => `  - ${entry.worker}:${entry.name}\n    wrangler secret delete ${entry.name} --name ${entry.worker}`,
    )
    .join("\n");
}

function bindingAppliesToEnv(binding, env) {
  const scope = binding.envs ?? "all";
  return scope === "all" || scope === env;
}

/**
 * Secret names an app consumes in a given environment.
 * @param {string} app
 * @param {"preview"|"production"} env
 * @param {{ requiredOnly?: boolean, source?: "symmetric"|"workos" }} [opts]
 * @returns {string[]}
 */
export function secretsForApp(app, env, opts = {}) {
  const bindings = SECRET_ROUTING[app] ?? {};
  return Object.entries(bindings)
    .filter(([, binding]) => bindingAppliesToEnv(binding, env))
    .filter(([, binding]) => (opts.requiredOnly ? binding.required : true))
    .filter(([, binding]) => (opts.source ? (binding.source ?? "symmetric") === opts.source : true))
    .map(([name]) => name);
}

/**
 * The `secrets.required` array a Worker should declare for an environment:
 * the names that hard-fail the deploy when missing.
 * @param {string} app
 * @param {"preview"|"production"} env
 * @returns {string[]}
 */
export function requiredSecretsForApp(app, env) {
  return secretsForApp(app, env, { requiredOnly: true }).sort();
}
