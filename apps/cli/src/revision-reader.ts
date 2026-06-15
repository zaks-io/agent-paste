import type { ApiClient } from "@agent-paste/api-client";
import type { RevisionReader } from "@agent-paste/revise-core";

/**
 * CLI read-side adapter for the shared revise engine, twin of `apiClientTransport`.
 * A thin pass-through to the HTTP `ApiClient`: the engine reads the base Agent View
 * + one file's decrypted plaintext, applies the literal edits, and publishes a
 * verified patch. Two real adapters (this and MCP's `serviceBindingReader`) make the
 * `RevisionReader` seam pass the deletion test (ADR 0091).
 */
export function apiClientReader(client: ApiClient): RevisionReader {
  return {
    readArtifact: (artifactId) => client.artifacts.getAgentView(artifactId),
    readFile: (artifactId, path, revisionId) => client.artifacts.readFile(artifactId, path, revisionId),
  };
}
