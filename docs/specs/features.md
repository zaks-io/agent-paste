# Features

## Shipped publishing surface

| Feature                    | Behavior                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| File and directory publish | Uploads content and creates an immutable Revision.                                                                                      |
| Artifact URL               | Stable, unguessable, no-login subdomain for the latest Published Revision.                                                              |
| Artifact reference         | CLI and MCP accept the short artifact ID, the `art_...` ID, the full Artifact URL, or the bare subdomain.                               |
| Revise                     | Publishes a new Revision while preserving the Artifact URL.                                                                             |
| Read and edit              | CLI `pull` and MCP `read_file` read one stored file. CLI `edit` and MCP `multi_edit` apply literal edits as a Revision.                 |
| File types                 | Any file can be the entrypoint. Each file is served by its extension. See below.                                                        |
| Ephemeral publish          | Publishes without login, expires after 24 hours, and can be claimed.                                                                    |
| CLI authentication         | `AGENT_PASTE_API_KEY`, saved browser login, or `login --device-code` for sandboxes and remote shells.                                   |
| CLI, MCP, REST             | Expose the same one-URL publish contract.                                                                                               |
| Product feedback           | CLI `feedback`, MCP `feedback`, and authenticated REST persist bounded, Workspace-owned feedback.                                       |
| Pin                        | Pinned Artifacts skip Auto Deletion until unpinned. Pinning is a dashboard action.                                                      |
| Dashboard                  | Manages Artifacts, credentials, audit, settings, billing, and claims.                                                                   |
| Bundles                    | Revisions up to 16 MiB of input are eligible for a zip, subject to bundle limits. CLI `download` saves it; larger bundles are disabled. |
| Browser caching            | Inline static assets reuse a private browser cache for up to one hour, capped by signed expiry. HTML revalidates.                       |
| Safety controls            | Artifact deletion, platform lockdown, denylist checks, and rate limits.                                                                 |

## File types

The `content` Worker serves every file with the content type its extension
implies. HTML runs as a website, and images, audio, video, and text open in the
browser's built-in viewer. Markdown is served as `text/markdown` source and is
not converted to HTML. PDFs and unrecognized extensions download instead of
opening. MCP publishes one text file per call, and its `render_mode`
argument only picks `index.html`, `index.md`, or `content.txt`.

## Retired surface

The app viewer, iframe renderer, Render Mode, Private Link, Access Link, Share Link, Revision
Link, visibility commands, and live viewer push are retired. Their historical
database and migration structures may remain until a dedicated cleanup
migration, but they are not product features or callable routes.
