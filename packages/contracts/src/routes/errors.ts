const actorRateLimitErrors = ["rate_limited_actor", "rate_limited_workspace"] as const;
const apiKeyReadErrors = ["not_authenticated", "invalid_auth", "database_unavailable"] as const;
const apiKeyActorReadErrors = [...apiKeyReadErrors, ...actorRateLimitErrors] as const;
const apiKeyMutationErrors = [
  ...apiKeyActorReadErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "usage_policy_exceeded",
  "forbidden",
  "revision_ceiling_exceeded",
] as const;
const webReadErrors = ["not_authenticated", "forbidden", "database_unavailable"] as const;
const webActorReadErrors = [...webReadErrors, ...actorRateLimitErrors] as const;
const webMutationErrors = [...webActorReadErrors, "invalid_request"] as const;
const webIdempotentMutationErrors = [
  ...webMutationErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "api_key_not_found",
] as const;
const webCallbackErrors = [...webReadErrors, "invalid_request", "idempotency_in_flight"] as const;
// Operator routes never advertise not_authenticated/forbidden: every auth
// failure collapses to a generic not_found so the surface is non-enumerable
// (ADR 0046).
const operatorMutationErrors = [
  "not_found",
  "invalid_request",
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "database_unavailable",
  ...actorRateLimitErrors,
] as const;
// Operator read routes drop the idempotency errors and add the pagination
// errors, but keep the same not_found collapse so the surface stays
// non-enumerable (ADR 0046).
const operatorReadErrors = [
  "not_found",
  "invalid_cursor",
  "invalid_request",
  "database_unavailable",
  ...actorRateLimitErrors,
] as const;
const ephemeralProvisionErrors = [
  "invalid_request",
  "ephemeral_provision_rate_limited",
  "ephemeral_provision_unavailable",
  "database_unavailable",
] as const;
const ephemeralClaimErrors = [...webIdempotentMutationErrors, "not_found", "storage_unavailable"] as const;

export const routeErrorGroups = {
  apiKeyRead: apiKeyReadErrors,
  apiKeyActorRead: apiKeyActorReadErrors,
  apiKeyMutation: apiKeyMutationErrors,
  webRead: webReadErrors,
  webActorRead: webActorReadErrors,
  webMutation: webMutationErrors,
  webIdempotentMutation: webIdempotentMutationErrors,
  webCallback: webCallbackErrors,
  operatorMutation: operatorMutationErrors,
  operatorRead: operatorReadErrors,
  ephemeralProvision: ephemeralProvisionErrors,
  ephemeralClaim: ephemeralClaimErrors,
} as const;
