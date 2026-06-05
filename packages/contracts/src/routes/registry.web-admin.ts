import { routeErrorGroups } from "./errors.js";

const {
  operatorMutation: operatorMutationErrors,
  operatorRead: operatorReadErrors,
} = routeErrorGroups;

/**
 * Web operator-admin route contracts, split out of `registry.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit. Spread into `routeContracts`
 * with `as const` so route-id literal inference is preserved.
 */
export const webAdminRouteContracts = [
  {
    id: "web.admin.lockdown.set",
    app: "api",
    method: "POST",
    path: "/v1/web/admin/lockdowns",
    auth: "operator",
    scopes: [],
    idempotency: "required",
    rateLimit: "actor",
    requestSchema: "SetLockdownRequest",
    responseSchema: "LockdownDetail",
    errors: operatorMutationErrors,
  },
  {
    id: "web.admin.lockdown.list",
    app: "api",
    method: "GET",
    path: "/v1/web/admin/lockdowns",
    auth: "operator",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "LockdownListResponse",
    errors: operatorReadErrors,
  },
  {
    id: "web.admin.lockdown.lift",
    app: "api",
    method: "DELETE",
    path: "/v1/web/admin/lockdowns/{scope}/{target_id}",
    auth: "operator",
    scopes: [],
    idempotency: "required",
    rateLimit: "actor",
    responseSchema: "LockdownDetail",
    errors: operatorMutationErrors,
  },
  {
    id: "web.admin.events.list",
    app: "api",
    method: "GET",
    path: "/v1/web/admin/events",
    auth: "operator",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "WebOperatorEventListResponse",
    errors: operatorReadErrors,
  },
] as const;
