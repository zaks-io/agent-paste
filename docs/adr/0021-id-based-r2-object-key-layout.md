# ID-Based R2 Object Key Layout

Status note: amended by AP-294. Revision file keys and upload-session PUT targets use the legacy artifact-scoped prefix, not the env-scoped file prefix below. Derived bundles and env-scoped purge prefixes match the env-scoped shapes. Current key shapes live in [`docs/specs/data-model.md`](../specs/data-model.md#r2-object-key-layout).

R2 object keys will be derived from environment, workspace, artifact, revision, upload session, and normalized file paths rather than human titles or mutable names. Upload sessions reserve a Revision identity up front so agents can upload directly to final Revision file keys; finalization verifies the uploaded objects and records Draft Revision metadata without copying bytes or changing the Published Revision.

## Consequences

- Published files should use keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/files/{path}`. **Amended (AP-294):** shipped revision files use the legacy prefix `artifacts/{artifactId}/revisions/{revisionId}/files/{path}` instead. See [`docs/specs/data-model.md`](../specs/data-model.md#r2-object-key-layout).
- Derived bundles should use keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/bundle.zip`. Current behavior; see [`docs/specs/data-model.md`](../specs/data-model.md#r2-object-key-layout).
- Upload sessions should reserve the `revisionId` and issue short-lived signed write URLs for final keys shaped like `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/files/{path}`. **Amended (AP-294):** upload PUT targets use the legacy revision-file prefix above, not the env-scoped file prefix. See [`docs/specs/data-model.md`](../specs/data-model.md#r2-object-key-layout).
- Signed upload URLs may expose opaque ID-based R2 keys to uploaders.
- Signed upload URLs should be single-use for one reserved key and should not overwrite existing objects.
- Upload finalization should verify the expected file set and fail when unexpected objects exist under the reserved revision prefix.
- Upload finalization failures from missing or incomplete expected objects should remain retryable until the upload session expires.
- Upload finalization failures from unexpected objects should be terminal and require a new upload session.
- Abandoned upload sessions can leave unpublished Revision objects, which cleanup jobs should remove based on metadata.
- Preview environments should add a preview namespace such as `preview/pr-{number}` through bucket choice or key prefix.
- User-provided titles and labels should not appear in R2 key prefixes.
- Normalized file paths are untrusted input: they may appear in manifests and audit summaries after validation, normalization, and output escaping, but must never be treated as trusted display strings.
- File paths may include nested directories.
- Path normalization should reject absolute paths, traversal segments, empty segments, and control characters.
- Upload finalization should fail when two uploaded paths normalize to the same file path.
- Normalized file paths are case-sensitive.
- Normalized file paths should preserve valid Unicode using NFC normalization, and must be encoded safely in URLs and escaped for display.
