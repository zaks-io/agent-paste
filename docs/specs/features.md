# Feature Index

This index lists the shipped user-facing feature set. The original CLI-first MVP
baseline still lives in [`mvp.md`](./mvp.md), but the hosted service now includes
the later dashboard, Access Link, lifecycle, billing, ephemeral publish, and MCP
phases recorded in [`docs/ops/project-status.md`](../ops/project-status.md).

## Shipped User-Facing Features

### CLI

| Feature                      | Current behavior                                                                                                           | Primary users     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `agent-paste login`          | Runs browser OAuth and stores a scoped local credential.                                                                   | Humans, agents    |
| `agent-paste logout`         | Revokes the stored credential when possible and removes it locally.                                                        | Humans, agents    |
| `agent-paste whoami`         | Verifies the effective actor, Workspace, and scopes.                                                                       | Humans, agents    |
| `agent-paste publish`        | Publishes a file or folder, or a new Revision with `--artifact-id`; returns owner/member URLs plus exact Revision content. | Agents, CI        |
| `--ephemeral`                | Publishes with no login, then prints a working `unlisted_url` plus a one-time Claim Token link.                            | Unattended agents |
| Standalone binary installers | `/install.sh` and `/install.ps1` download, verify, and install signed release assets.                                      | Humans, agents    |
| `agent-paste upgrade`        | Self-updates standalone binary installs by downloading and verifying a release asset.                                      | Humans, agents    |

### Hosted Surfaces

| Surface        | Current behavior                                                                                                        | Primary users       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| API Worker     | Authenticated CLI/MCP control plane, Artifact metadata, Agent View, web/operator routes, billing, and ephemeral routes. | CLI, MCP, dashboard |
| Upload Worker  | Upload Sessions, signed upload-worker PUT URLs, validation, and private R2 writes.                                      | CLI, MCP publish    |
| Content Worker | Signed file and Bundle reads from private R2 on the isolated content origin.                                            | Recipients          |
| Web Dashboard  | Workspace, Artifacts, Revisions, Access Links, credentials, audit, settings, billing, and claim UI.                     | Humans              |
| Stream Worker  | Live Update SSE fan-out for authorized viewers.                                                                         | Viewers             |
| MCP Worker     | OAuth-only Streamable HTTP MCP with twelve text-focused tools.                                                          | Hosted agents       |
| Apex Worker    | Marketing, legal, install scripts, `/llms.txt`, `/agents.md`, and public docs.                                          | Humans, agents      |

### Artifact Lifecycle

| Feature                | Current behavior                                                                                     | Primary users              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| Artifact               | Durable, addressable package owned by one Workspace.                                                 | All readers and publishers |
| Revision               | Immutable saved state. Publishing to an existing Artifact appends a new Published Revision.          | Publishers                 |
| Upload Session         | Temporary workflow for collecting expected files before finalize.                                    | CLI, MCP                   |
| Artifact URL           | Authenticated Artifact detail URL for Workspace management.                                          | Workspace members          |
| Access Link            | Revocable grant family for unauthenticated read access.                                              | Humans, agents             |
| Access Link Signed URL | URL minted from an Access Link; `/al/{publicId}#{blob}` carries credential material in the fragment. | Humans, agents             |
| Share Link             | Access Link type that follows the latest Published Revision in the Artifact Viewer.                  | Humans, agents             |
| Revision Link          | Snapshot Access Link pinned to a specific Revision.                                                  | Humans, agents             |
| Revision Content URL   | Direct signed Content Origin URL for one Revision; expires and does not Live Update.                 | Humans, agents             |
| Bundle                 | Generated archive for a complete Revision file tree.                                                 | Humans, agents             |
| Live Updates           | Pro viewers advance to the latest Published Revision without manual refresh.                         | Humans                     |

### Billing And Limits

| Feature               | Current behavior                                                                          | Primary users |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| Free and Pro Plans    | `workspaces.plan` selects plan-derived Usage Policy values when billing is enabled.       | Members       |
| Stripe Checkout       | Dashboard creates Checkout sessions and activates Pro synchronously on successful return. | Members       |
| Stripe Portal         | Dashboard opens Customer Portal for subscription management.                              | Members       |
| Invoices              | Dashboard lists Stripe invoices with hosted invoice/PDF links when Stripe provides them.  | Members       |
| Daily write allowance | New-Artifact writes are capped by tier: Ephemeral 20, Free 100, Pro 2000 per day.         | Publishers    |
| Reads                 | Recipient reads stay free and are gated only by Artifact rate-limit abuse ceilings.       | Recipients    |

## Still Out Of Scope

| Feature             | Status                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Public SDK          | Intentionally out of scope; CLI, MCP, and the internal client are enough. |
| Multi-workspace UI  | The dashboard models one Personal Workspace per member for now.           |
| Permanent storage   | Artifacts remain transient by default with Plan-bounded TTLs.             |
| Social/discovery UI | No public feed, profiles, stars, or directory browsing.                   |
