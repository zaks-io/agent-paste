import * as z from "zod";

// This limit applies to each publish/revision body and each old/new edit string.
// The complete JSON-RPC request is separately capped at 1 MiB, so multi-edit
// callers must also keep the aggregate payload below the transport limit.
export const MAX_MCP_TEXT_CHARACTERS = 192 * 1024;

// One literal old/new replacement, the same shape as Claude's Edit/MultiEdit
// tools. Matching is literal: old_string must occur exactly once in the base
// unless replace_all is set.
export const McpEdit = z
  .object({
    old_string: z
      .string()
      .min(1)
      .max(MAX_MCP_TEXT_CHARACTERS)
      .describe("Exact text to find in the file. Must match once unless replace_all is true."),
    new_string: z
      .string()
      .max(MAX_MCP_TEXT_CHARACTERS)
      .describe("Text to replace it with (may be empty to delete the match)."),
    replace_all: z
      .boolean()
      .optional()
      .describe("Replace every occurrence instead of requiring a single unique match."),
  })
  .strict();
export type McpEdit = z.infer<typeof McpEdit>;
