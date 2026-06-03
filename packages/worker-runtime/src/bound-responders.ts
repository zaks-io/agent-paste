import type { Context, MiddlewareHandler } from "hono";
import { type AppErrorCode, type ErrorResponseOptions, errorResponse, jsonResponse } from "./errors.js";

export const BOUND_RESPONDERS_KEY = "boundResponders";

export type BoundResponders = {
  respondError: (code: AppErrorCode, messageOrOptions?: string | ErrorResponseOptions) => Response;
  respondJson: (body: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
};

export type BoundResponderConfig = {
  docsBaseUrl?: (context: Context) => string | undefined;
  defaultErrorHeaders?: (context: Context) => Record<string, string>;
};

export type BoundRespondersVariables = {
  [BOUND_RESPONDERS_KEY]: BoundResponders;
};

export function boundResponderOptions(
  context: Context,
  config: BoundResponderConfig,
): { docsBaseUrl?: string; defaultHeaders?: Record<string, string> } {
  const options: { docsBaseUrl?: string; defaultHeaders?: Record<string, string> } = {};
  const docsBaseUrl = config.docsBaseUrl?.(context);
  if (docsBaseUrl !== undefined) {
    options.docsBaseUrl = docsBaseUrl;
  }
  const defaultHeaders = config.defaultErrorHeaders?.(context);
  if (defaultHeaders !== undefined) {
    options.defaultHeaders = defaultHeaders;
  }
  return options;
}

export function createBoundResponders(
  context: Context,
  options: { docsBaseUrl?: string; defaultHeaders?: Record<string, string> } = {},
): BoundResponders {
  return {
    respondError(code, messageOrOptions) {
      const responseOptions: ErrorResponseOptions =
        typeof messageOrOptions === "string" ? { message: messageOrOptions } : (messageOrOptions ?? {});
      return errorResponse(context, code, {
        docsBaseUrl: options.docsBaseUrl,
        defaultHeaders: options.defaultHeaders,
        ...responseOptions,
      });
    },
    respondJson(body, status = 200, extraHeaders = {}) {
      return jsonResponse(context, body, status, {
        ...(options.defaultHeaders ?? {}),
        ...extraHeaders,
      });
    },
  };
}

export function boundRespondersMiddleware(
  config: BoundResponderConfig,
): MiddlewareHandler<{ Variables: BoundRespondersVariables }> {
  return async (context, next) => {
    context.set(BOUND_RESPONDERS_KEY, createBoundResponders(context, boundResponderOptions(context, config)));
    await next();
  };
}

export function getBoundResponders(context: Context): BoundResponders {
  const bound = context.get(BOUND_RESPONDERS_KEY);
  if (!bound) {
    throw new Error("boundRespondersMiddleware must run before getBoundResponders");
  }
  return bound;
}
