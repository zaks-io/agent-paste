# Features

## Publishing surface

| Feature                    | Behavior                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File and directory publish | Uploads content and creates an immutable Revision.                                                                                                                                               |
| Artifact URL               | Stable, unguessable, no-login subdomain for the latest Published Revision.                                                                                                                       |
| Artifact reference         | CLI and MCP accept the short artifact ID, the `art_...` ID, the full Artifact URL, or the bare subdomain.                                                                                        |
| Revise                     | Publishes a new Revision while preserving the Artifact URL.                                                                                                                                      |
| Read and edit              | CLI `pull` reads one file or downloads selected paths into a directory. CLI `edit` and MCP `multi_edit` preserve literal text editing.                                                           |
| Partial sync               | Guarded path updates preserve omitted files and detect overlapping changes. Full-tree and prefix mirrors guard their selected snapshot.                                                          |
| Large transfers            | Claimed workspaces accept 250 MiB files, 2 GiB Revisions, and 10,000 files. Chunk uploads and file-wise downloads resume after interruption.                                                     |
| Storage budgets            | Deduplicated stored bytes and pending uploads are budgeted per workspace. Defaults are 5 GiB Free and 50 GiB Pro; existing history is preserved.                                                 |
| File types                 | Any file can be the entrypoint. Each file is served by its extension. See below.                                                                                                                 |
| Ephemeral publish          | Publishes without login, expires after 24 hours, and can be claimed.                                                                                                                             |
| CLI authentication         | `AGENT_PASTE_API_KEY`, saved browser login, or `login --device-code` for sandboxes and remote shells.                                                                                            |
| CLI, MCP, REST             | Expose the same one-URL publish contract.                                                                                                                                                        |
| Product feedback           | CLI `feedback`, MCP `feedback`, and authenticated REST persist bounded, Workspace-owned feedback.                                                                                                |
| Pin                        | Dashboard, CLI, and publish-scoped MCP/API actors can pin indefinitely. Unpin starts a fresh retention window.                                                                                   |
| Dashboard                  | Manages Artifacts, credentials, audit, settings, billing, and claims.                                                                                                                            |
| Bundles                    | Revisions up to 16 MiB of input are eligible for a zip, subject to bundle limits. CLI `download` saves it; larger or chunked Revisions use file-wise `pull --output`.                            |
| Browser caching            | Inline static assets reuse a private browser cache for up to one hour, capped by signed expiry. HTML revalidates. Content-hash validators preserve unchanged-file revalidation across Revisions. |
| Safety controls            | Artifact deletion, platform lockdown, denylist checks, and rate limits.                                                                                                                          |

Production deployment status is tracked in [project-status.md](../ops/project-status.md).

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
