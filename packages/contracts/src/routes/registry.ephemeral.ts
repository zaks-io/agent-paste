import { routeErrorGroups } from "./errors.js";

const { ephemeralProvision: ephemeralProvisionErrors, ephemeralClaim: ephemeralClaimErrors } = routeErrorGroups;

/**
 * Ephemeral workspace route contracts, split out of `registry.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit. Spread into `routeContracts`
 * with `as const` so route-id literal inference is preserved.
 */
export const ephemeralRouteContracts = [
  {
    id: "ephemeral.provision",
    app: "api",
    method: "POST",
    path: "/v1/ephemeral/provision",
    auth: "none",
    scopes: [],
    idempotency: "none",
    rateLimit: "ephemeral_provision",
    allowEmptyBody: true,
    requestSchema: "EphemeralProvisionRequest",
    responseSchema: "EphemeralProvisionResponse",
    errors: ephemeralProvisionErrors,
  },
  {
    id: "ephemeral.claim",
    app: "api",
    method: "POST",
    path: "/v1/ephemeral/claim",
    auth: "workos_access_token",
    scopes: [],
    idempotency: "required",
    rateLimit: "actor",
    requestSchema: "EphemeralClaimRequest",
    responseSchema: "EphemeralClaimResponse",
    errors: ephemeralClaimErrors,
  },
] as const;
