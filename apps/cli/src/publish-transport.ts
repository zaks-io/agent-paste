import { AgentPasteError, type ApiClient, type PublishTransport } from "@agent-paste/api-client";
import { PublishResult } from "@agent-paste/contracts/upload-sessions";
export function apiClientTransport(client: ApiClient): PublishTransport {
  return {
    createUploadSession: (body, key) => client.uploadSessions.create(body, key),
    appendFiles: (id, body, key) => client.uploadSessions.appendFiles(id, body, key),
    targets: (id, query) => client.uploadSessions.targets(id, query),
    completeFiles: (id, body, key) => client.uploadSessions.completeFiles(id, body, key),
    listFiles: (id, query) => client.artifactFiles.list(id, query),
    getAgentView: (id, revision) =>
      revision ? client.artifacts.getRevisionAgentView(id, revision) : client.artifacts.getAgentView(id),
    putFile: (url, bytes, headers) => client.putFile(url, bytes as BodyInit, headers),
    finalize: (id, key) => client.uploadSessions.finalize(id, key),
    publishRevision: async (artifactId, revisionId, key, body) => {
      try {
        return await client.revisions.publish(artifactId, revisionId, key, body);
      } catch (error) {
        if (body?.include_retention || error instanceof AgentPasteError) throw error;
        try {
          const view = await client.artifacts.getRevisionAgentView(artifactId, revisionId);
          if (view.artifact_id === artifactId && view.revision_id === revisionId) {
            const result = PublishResult.parse({
              artifact_id: view.artifact_id,
              revision_id: view.revision_id,
              title: view.title,
              url: view.url,
              expires_at: view.expires_at,
            });
            process.stderr.write(
              "Publish response failed after commit; recovered the exact Artifact URL through Agent View.\n",
            );
            return result;
          }
        } catch {
          /* Preserve the original publish error if recovery fails. */
        }
        throw error;
      }
    },
  };
}
