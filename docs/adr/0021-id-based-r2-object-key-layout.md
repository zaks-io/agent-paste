# ID-Based R2 Object Key Layout

R2 object keys will be derived from environment, workspace, artifact, revision, upload session, and normalized file paths rather than human titles or mutable names. Upload sessions reserve a Revision identity up front so agents can upload directly to final Revision file keys; finalization verifies the uploaded objects and publishes metadata without copying bytes.

## Consequences

- Published files should use keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/files/{path}`.
- Derived bundles should use keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/bundle.zip`.
- Upload sessions should reserve the `revisionId` and issue upload URLs for final keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/files/{path}`.
- Abandoned upload sessions can leave unpublished Revision objects, which cleanup jobs should remove based on metadata.
- Preview environments should add a preview namespace such as `preview/pr-{number}` through bucket choice or key prefix.
- User-provided titles and labels should not appear in R2 key prefixes.
