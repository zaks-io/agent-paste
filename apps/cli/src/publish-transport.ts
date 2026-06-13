import type { ApiClient, PublishTransport } from "@agent-paste/api-client";

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
    publishRevision: (artifactId, revisionId, key, body) => client.revisions.publish(artifactId, revisionId, key, body),
  };
}
