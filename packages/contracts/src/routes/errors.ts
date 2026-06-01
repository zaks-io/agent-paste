const apiKeyReadErrors = ["not_authenticated", "invalid_auth", "database_unavailable"] as const;
const apiKeyMutationErrors = [
  ...apiKeyReadErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "usage_policy_exceeded",
] as const;
const webReadErrors = ["not_authenticated", "forbidden", "database_unavailable"] as const;
const webMutationErrors = [...webReadErrors, "invalid_request"] as const;
const webIdempotentMutationErrors = [...webMutationErrors, "invalid_idempotency_key", "idempotency_in_flight"] as const;
const webCallbackErrors = [...webMutationErrors, "idempotency_in_flight"] as const;
// Operator routes never advertise not_authenticated/forbidden: every auth
// failure collapses to a generic not_found so the surface is non-enumerable
// (ADR 0046).
const operatorMutationErrors = [
  "not_found",
  "invalid_request",
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "database_unavailable",
] as const;
// Operator read routes drop the idempotency errors and add the pagination
// errors, but keep the same not_found collapse so the surface stays
// non-enumerable (ADR 0046).
const operatorReadErrors = ["not_found", "invalid_cursor", "invalid_request", "database_unavailable"] as const;

export const routeErrorGroups = {
  apiKeyRead: apiKeyReadErrors,
  apiKeyMutation: apiKeyMutationErrors,
  webRead: webReadErrors,
  webMutation: webMutationErrors,
  webIdempotentMutation: webIdempotentMutationErrors,
  webCallback: webCallbackErrors,
  operatorMutation: operatorMutationErrors,
  operatorRead: operatorReadErrors,
} as const;
