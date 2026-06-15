import { AgentView, ArtifactFileContent, mapMcpProtocolError } from "@agent-paste/contracts";
import type { RevisionReader } from "@agent-paste/revise-core";
import { type ApiServiceBinding, type ForwardToApiResult, forwardToApiRoute } from "./forward.js";
import { ForwardError } from "./publish-transport.js";
import { zodIssueMetadata } from "./zod-issue-metadata.js";

export type RevisionReaderDeps = {
  api: ApiServiceBinding;
  bearerToken: string;
};

/**
 * MCP read-side adapter for `@agent-paste/revise-core`, twin of
 * `serviceBindingTransport`. Forwards the Agent View + file-content routes over
 * the api service binding and unwraps them into the engine's contract types. A
 * forward failure rethrows as a `ForwardError` so the tool handler rebuilds the
 * mapped MCP envelope (same propagation contract as the publish transport).
 */
export function serviceBindingReader(deps: RevisionReaderDeps): RevisionReader {
  return {
    readArtifact: (artifactId) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: "agentView.getLatest",
        params: { artifact_id: artifactId },
        bearerToken: deps.bearerToken,
      }).then((result) => unwrap(result, AgentView, "agentView.getLatest")),

    readFile: (artifactId, path, revisionId) =>
      forwardToApiRoute({
        api: deps.api,
        routeId: "artifacts.fileContent",
        params: { artifact_id: artifactId },
        query: { path, revision_id: revisionId },
        bearerToken: deps.bearerToken,
      }).then((result) => unwrap(result, ArtifactFileContent, "artifacts.fileContent")),
  };
}

function unwrap<T>(
  result: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  routeId: string,
): T {
  if (!result.ok) {
    throw new ForwardError(result.error);
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    // 200 from upstream but the body failed our contract: deploy skew / schema
    // drift. Log only issue metadata, never the raw error: the body carries the
    // decrypted file content.
    console.error("mcp: revise read response schema validation failed", {
      routeId,
      issues: zodIssueMetadata(parsed.error),
    });
    throw new ForwardError(mapMcpProtocolError("internal_error", "internal_error"));
  }
  return parsed.data;
}
