import type { mapMcpProtocolError } from "@agent-paste/contracts";
import type { ApiServiceBinding, UploadServiceBinding } from "./forward.js";

export type McpToolDeps = {
  api: ApiServiceBinding;
  upload: UploadServiceBinding;
  tokenSub: string;
  jsonRpcId: string | number;
};

export type McpToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ReturnType<typeof mapMcpProtocolError> };
