import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { mcpToolContracts } from "./registry.js";
import { mcpToolInputSchemas } from "./tool-schemas.js";
import type { McpToolListEntry } from "./types.js";

/** MCP `tools/list` descriptors derived from Zod input schemas (ADR 0061). */
export function buildMcpToolList(): { tools: McpToolListEntry[] } {
  const registry = new OpenAPIRegistry();
  for (const tool of mcpToolContracts) {
    registry.register(`McpInput_${tool.name}`, mcpToolInputSchemas[tool.name]);
  }
  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "agent-paste-mcp-tools", version: "0.1.0" },
  });
  const schemas = document.components?.schemas ?? {};
  return {
    tools: mcpToolContracts.map((tool) => {
      const schema = schemas[`McpInput_${tool.name}`];
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: (schema ?? { type: "object" }) as Record<string, unknown>,
      };
    }),
  };
}
