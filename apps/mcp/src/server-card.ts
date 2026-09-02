import { MCP_RESOURCE_INDICATOR, trimTrailingSlashes } from "@agent-paste/contracts";

export const MCP_SERVER_INFO = {
  name: "agent-paste",
  version: "0.1.0",
} as const;

export function mcpServerCard(env: { MCP_RESOURCE?: string }): Record<string, unknown> {
  const endpoint = trimTrailingSlashes(env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR);
  return {
    serverInfo: MCP_SERVER_INFO,
    transport: {
      type: "streamable-http",
      endpoint,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
  };
}
