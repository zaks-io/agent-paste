import type { ErrorCode } from "../common.js";
import {
  MCP_API_ERROR_HTTP_STATUS,
  type McpProtocolErrorCode,
} from "./error-codes.js";
import {
  MCP_JSONRPC_APPLICATION_ERROR,
  MCP_JSONRPC_INVALID_PARAMS,
  MCP_JSONRPC_METHOD_NOT_FOUND,
} from "./constants.js";
import type { McpJsonRpcError, McpMappedToolError } from "./jsonrpc.js";

export function mapApiErrorToMcp(error: {
  code: ErrorCode;
  message: string;
  requestId?: string;
  docs?: string;
}): McpMappedToolError {
  return {
    code: error.code,
    message: error.message,
    jsonRpcCode: MCP_JSONRPC_APPLICATION_ERROR,
    httpStatus: MCP_API_ERROR_HTTP_STATUS[error.code] ?? 500,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.docs ? { docs: error.docs } : {}),
  };
}

export function mapMcpProtocolError(code: McpProtocolErrorCode, message: string): McpMappedToolError {
  const httpStatus =
    code === "invalid_token"
      ? 401
      : code === "insufficient_scope"
        ? 403
        : code === "invalid_params"
          ? 400
          : code === "method_not_found"
            ? 404
            : 500;
  const jsonRpcCode =
    code === "invalid_params"
      ? MCP_JSONRPC_INVALID_PARAMS
      : code === "method_not_found"
        ? MCP_JSONRPC_METHOD_NOT_FOUND
        : MCP_JSONRPC_APPLICATION_ERROR;

  return {
    code,
    message,
    jsonRpcCode,
    httpStatus,
  };
}

export function toMcpJsonRpcError(error: McpMappedToolError): McpJsonRpcError {
  return {
    code: error.jsonRpcCode,
    message: error.message,
    data: {
      code: error.code,
      message: error.message,
      ...(error.requestId ? { request_id: error.requestId } : {}),
      ...(error.docs ? { docs: error.docs } : {}),
    },
  };
}
