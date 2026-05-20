# Manifest Shape and Creator Visibility on Agent View

A **Manifest** carries `artifact_id`, `revision_id`, `revision_number`, `entrypoint`, `render_mode`, `created_at`, and a typed `creator` reference. File listing, content links, **Display Metadata**, **Safety Warnings**, and **Bundle Availability** live beside the **Manifest** in **Agent View**, never inside it. The owning **Workspace** identifier is never carried on any **Manifest** surface. The `creator` field is omitted on **Agent View** returned through an unauthenticated **Access Link** resolve and populated on the authenticated `GET /v1/artifacts/{id}/agent-view` surface.

## Considered Options

- **Embed everything in Manifest (files, display metadata, warnings, bundle).** Simplest envelope, but conflates platform-controlled identity data with the file tree, the safety surface, and bundle state, all of which evolve independently. **Display Metadata** is mutable without a new **Revision**; embedding it inside the **Manifest** would force re-issuing every cached **Manifest** on a title change. Rejected.
- **Include `creator` on every Agent View surface.** Symmetric and easy to reason about. Leaks **Workspace Member** or **API Key** identifiers to anyone who opens a **Share Link**, enabling enumeration of who works in a **Workspace**. Rejected.
- **Omit `creator` everywhere.** Avoids the leakage but removes authoring signal even from the dashboard, where it is legitimately useful. Rejected.
- **Split visibility (chosen).** `creator` returned on the authenticated artifact-scoped **Agent View**, omitted on unauthenticated **Access Link** resolve. Same **Manifest** field set; one field nulled at the boundary.

## Consequences

- Public-facing **Agent View** responses carry the **Manifest** plus five sibling fields: `files`, `content_prefix`, `display_metadata`, `safety_warnings`, `bundle`. Their shapes are pinned in [ADR 0054](./0054-agent-view-envelope-shape.md).
- `creator` is a typed reference `{ type: 'api_key' | 'workspace_member', public_id }`, never a display name or email; downstream surfaces resolve the reference if and when needed.
- `workspace_id` is never on the **Manifest**. An authenticated caller knows their **Workspace** from session or key context.
- Adding fields is additive and non-breaking; removing fields is breaking and requires a versioned API change per [ADR 0023](./0023-versioned-public-rest-apis.md).
- The **Manifest** is platform-controlled data per CONTEXT.md and per [ADR 0024](./0024-treat-agent-provided-data-as-untrusted.md); none of its field values are agent-controlled at serialization time.
