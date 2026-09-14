# One Artifact ID

Status: Proposed. Amends [ADR 0094](./0094-capability-url-is-the-artifact-link.md) and [ADR 0096](./0096-shorter-base32-capability-ids.md).

## Context

An Artifact currently has two identities. The management ID (`art_` ULID) is
the primary key and appears in JSON output, MCP responses, Audit Events, and
dashboard URLs. The Capability ID (23-character grouped base32) is the
hostname label of the Artifact URL and is minted at first publish
(`upload-publish-workflow.ts` `setCapabilityIdIfMissing`). `ArtifactReference`
accepts either form plus the full URL.

Agents see both and have to learn that they are interchangeable on input but
different on output. The split existed because a Capability ID did not exist
before first publish, and because possession grants read access while the
management ID is safe to log.

Revision IDs (`rev_` ULID) carry a third shape for the same family of objects.

## Decision

1. The Capability ID is the Artifact ID. It is minted when the Artifact row is
   created, not at first publish, and stored as the primary key. The Capability
   Manifest is still written only at publish, so an unpublished ID resolves to
   nothing on the content host.
2. Every surface emits that ID as `artifact_id`: CLI JSON, MCP results, Agent
   View, list endpoints, Audit Events, and the dashboard route
   `/artifacts/<id>`. The `art_` form is emitted nowhere.
3. `ArtifactReference` keeps accepting `art_` IDs and full URLs on input so
   agents and bookmarks holding old values keep working. Existing rows keep
   their `art_` primary key and existing Capability ID; only new rows use the
   unified key. Legacy 32-hex Capability IDs remain valid per ADR 0096.
4. Revision IDs adopt the same grouped base32 shape with no prefix. They are
   not hostnames and carry no read capability; the shape is shared for
   consistency only. Existing `rev_` values remain valid on input.
5. Because the Artifact ID is now credential material everywhere it appears,
   the `api` and `web` Workers redact the `/artifacts/<id>` path segment in
   request logs the same way `content` already redacts the hostname label.
   Audit Event rows are workspace-scoped and keep the full ID.

## Rationale

One ID removes a class of agent mistakes with no loss of function. Minting at
creation closes the only structural reason for the split. The remaining reason,
loggability, is a redaction rule on two routes rather than a second identity.

The prefix carried no information an agent needed: the shape already
distinguishes an Artifact ID from a Revision ID by context, and the check
symbol catches transcription errors that the prefix never did.

## Consequences

- `docs/specs/cli.md`, `docs/specs/artifacts.md`, `CONTEXT.md`, and the MCP
  contract descriptions drop the "full URLs and `art_` IDs also work" caveats
  down to a single line about legacy input.
- `packages/tokens` content and agent-view codecs stop asserting `art_` and
  `rev_` prefixes and validate the grouped base32 shape instead.
- The `artifacts.capability_id` column becomes redundant for new rows. It
  stays for existing rows until a follow-up backfills `id` from it, which is a
  separate migration with its own rollback plan.
- CLI JSON `schema_version` stays at `"2"`. Field names and types are
  unchanged; only the ID format differs, and every consumer already accepts the
  base32 form on input.
- Two-agent review loops revise one shared ID and read history through
  `list_revisions` and `pull --revision-id`. The `LIFETIME_REVISION_CEILING` of
  100 is the practical limit on that loop and should be revisited separately.

## Done

- New Artifacts publish with `artifact_id` equal to the URL hostname label on
  CLI, MCP, and dashboard surfaces.
- `pull`, `edit`, `--artifact-id`, and every MCP `artifact_id` input accept the
  new ID, an `art_` ID, and a full URL.
- Request logs for `api` and `web` never contain a full Artifact ID.
- Specs and CONTEXT.md describe one Artifact ID and one Revision ID shape.
