import type { ApiClient, PublishTransport } from "@agent-paste/api-client";
import { PublishResult } from "@agent-paste/contracts";

/**
 * CLI transport for the shared publish module: a thin pass-through to the
 * HTTP `ApiClient`. `putFile` uploads to the signed `put_url` with no auth
 * header, which is exactly what the shared module requires.
 */
export function apiClientTransport(client: ApiClient): PublishTransport {
  return {
    createUploadSession: (body, key) => client.uploadSessions.create(body, key),
    // A Uint8Array is a valid fetch body; the cast bridges the lib BodyInit type.
    putFile: (url, bytes, headers) => client.putFile(url, bytes as BodyInit, headers),
    finalize: (id, key) => client.uploadSessions.finalize(id, key),
    publishRevision: async (artifactId, revisionId, key, body) => {
      try {
        return await client.revisions.publish(artifactId, revisionId, key, body);
      } catch (publishError) {
        // A publish mutates server state before the response is parsed. If the
        // response contract drifts or the connection drops after commit, verify
        // the exact finalized Revision through the authenticated read path so
        // its Artifact URL is not stranded. Never mask a real failure: recovery
        // succeeds only when the server reports this exact Revision.
        try {
          const view = await client.artifacts.getRevisionAgentView(artifactId, revisionId);
          if (view.artifact_id === artifactId && view.revision_id === revisionId) {
            const recovered = PublishResult.parse({
              artifact_id: view.artifact_id,
              revision_id: view.revision_id,
              title: view.title,
              url: view.url,
              expires_at: view.expires_at,
            });
            process.stderr.write(
              "Publish response failed after commit; recovered the exact Artifact URL through Agent View.\n",
            );
            return recovered;
          }
        } catch {
          // The original publish failure is the useful error. A recovery lookup
          // is best-effort evidence and must not replace it with a secondary one.
        }
        throw publishError;
      }
    },
  };
}
