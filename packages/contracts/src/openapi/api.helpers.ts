import { Cursor } from "../primitives.js";
import { z } from "../zod.js";
import { idempotencyKeyHeader, requestIdHeader } from "./shared.js";

export const pathStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "path", required: true, description },
  });

export const pathEnumParam = (name: string, values: readonly [string, ...string[]], description: string) =>
  z.enum(values).openapi({
    param: { name, in: "path", required: true, description },
  });

export const queryStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "query", required: true, description },
  });

export const queryOptionalStringParam = (name: string, description: string) =>
  z
    .string()
    .optional()
    .openapi({
      param: { name, in: "query", required: false, description },
    });

export const queryCursorParam = (name: string, description: string) =>
  Cursor.openapi({
    param: { name, in: "query", required: false, description },
  }).optional();

export const queryPageSizeParam = (name: string, description: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name, in: "query", required: false, description },
    });

export const params = (paramSchemas: Record<string, z.ZodTypeAny>) => z.object(paramSchemas);

export type ApiPathHelpers = {
  params: typeof params;
  pathStringParam: typeof pathStringParam;
  pathEnumParam: typeof pathEnumParam;
  queryStringParam: typeof queryStringParam;
  queryOptionalStringParam: typeof queryOptionalStringParam;
  queryCursorParam: typeof queryCursorParam;
  queryPageSizeParam: typeof queryPageSizeParam;
  idempotencyKeyHeader: typeof idempotencyKeyHeader;
  requestIdHeader: typeof requestIdHeader;
};

export function createApiPathHelpers(): ApiPathHelpers {
  return {
    params,
    pathStringParam,
    pathEnumParam,
    queryStringParam,
    queryOptionalStringParam,
    queryCursorParam,
    queryPageSizeParam,
    idempotencyKeyHeader,
    requestIdHeader,
  };
}
