import { z } from "../zod.js";
import {
  MCP_JSONRPC_APPLICATION_ERROR,
  MCP_JSONRPC_INVALID_PARAMS,
  MCP_JSONRPC_METHOD_NOT_FOUND,
  MCP_JSONRPC_VERSION,
} from "./constants.js";
import { McpToolErrorCode } from "./error-codes.js";
import { McpToolName } from "./schemas.js";

export const McpJsonRpcId = z.union([z.string(), z.number(), z.null()]);
export type McpJsonRpcId = z.infer<typeof McpJsonRpcId>;

export const McpJsonRpcRequest = z
  .object({
    jsonrpc: z.literal(MCP_JSONRPC_VERSION),
    id: McpJsonRpcId.optional(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type McpJsonRpcRequest = z.infer<typeof McpJsonRpcRequest>;

export const McpToolCallParams = z
  .object({
    name: McpToolName,
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type McpToolCallParams = z.infer<typeof McpToolCallParams>;

export const McpJsonRpcErrorData = z
  .object({
    code: McpToolErrorCode,
    message: z.string(),
    request_id: z.string().min(1).optional(),
    docs: z.string().url().optional(),
  })
  .strict();
export type McpJsonRpcErrorData = z.infer<typeof McpJsonRpcErrorData>;

export const McpJsonRpcError = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: McpJsonRpcErrorData.optional(),
  })
  .strict();
export type McpJsonRpcError = z.infer<typeof McpJsonRpcError>;

export type McpMappedToolError = {
  code: McpToolErrorCode;
  message: string;
  jsonRpcCode: number;
  httpStatus: number;
  requestId?: string;
  docs?: string;
};
