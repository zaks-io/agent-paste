import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { ActorType, OperationEventAction, OperationEventTargetType } from "../enums.js";
import { WorkspaceId } from "../primitives.js";
import { WebOperatorEventFocus } from "../web.js";
import { z } from "../zod.js";
import { schemaRef, standardJsonResponses } from "./responses.js";
import type { ApiPathHelpers } from "./api.helpers.js";

/**
 * Web operator-admin OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerWebAdminPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const {
    params,
    pathStringParam,
    pathEnumParam,
    queryCursorParam,
    queryPageSizeParam,
    idempotencyKeyHeader,
    requestIdHeader,
  } = helpers;

  registry.registerPath({
    method: "get",
    path: "/v1/web/admin/lockdowns",
    operationId: "web.admin.lockdown.list",
    summary: "List effective platform lockdowns (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of lockdowns to return, up to 100. Defaults to 50."),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("LockdownListResponse"), 200, { authenticated: false }),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/admin/lockdowns",
    operationId: "web.admin.lockdown.set",
    summary: "Set a platform lockdown on a workspace or artifact (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("SetLockdownRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("LockdownDetail"), 201, { authenticated: false }),
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/web/admin/lockdowns/{scope}/{target_id}",
    operationId: "web.admin.lockdown.lift",
    summary: "Lift a platform lockdown on a workspace or artifact (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      params: params({
        scope: pathEnumParam("scope", ["workspace", "artifact"], "Lockdown scope: workspace or artifact."),
        target_id: pathStringParam("target_id", "Locked-down workspace or artifact id."),
      }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("LockdownDetail"), 200, { authenticated: false }),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/admin/events",
    operationId: "web.admin.events.list",
    summary: "Browse cross-workspace audit and operation events (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of events to return, up to 100. Defaults to 50."),
        workspace_id: WorkspaceId.optional().openapi({
          param: {
            name: "workspace_id",
            in: "query",
            required: false,
            description: "Restrict results to one workspace.",
          },
        }),
        actor_type: ActorType.optional().openapi({
          param: {
            name: "actor_type",
            in: "query",
            required: false,
            description: "Filter by actor type (for example platform or member).",
          },
        }),
        action: OperationEventAction.optional().openapi({
          param: {
            name: "action",
            in: "query",
            required: false,
            description: "Filter by exact action verb.",
          },
        }),
        target_type: OperationEventTargetType.optional().openapi({
          param: {
            name: "target_type",
            in: "query",
            required: false,
            description: "Filter by target type.",
          },
        }),
        request_id: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .openapi({
            param: {
              name: "request_id",
              in: "query",
              required: false,
              description: "Filter by request id.",
            },
          }),
        focus: WebOperatorEventFocus.optional().openapi({
          param: {
            name: "focus",
            in: "query",
            required: false,
            description:
              "Preset filter: security (lockdowns, key revocation, destructive admin) or lifecycle (workspace, keys, artifacts, uploads, cleanup). Defaults to all.",
          },
        }),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebOperatorEventListResponse"), 200, { authenticated: false }),
  });
}
