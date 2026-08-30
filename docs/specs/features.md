# Features

## Shipped publishing surface

| Feature                    | Behavior                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| File and directory publish | Uploads content and creates an immutable Revision.                         |
| Artifact URL               | Stable, unguessable, no-login subdomain for the latest Published Revision. |
| Revise                     | Publishes a new Revision while preserving the Artifact URL.                |
| Ephemeral publish          | Publishes without login, expires automatically, and can be claimed.        |
| CLI, MCP, REST             | Expose the same one-URL publish contract.                                  |
| Dashboard                  | Manages Artifacts, credentials, audit, settings, billing, and claims.      |
| Bundles                    | Downloads an Artifact Revision as an archive.                              |
| Safety controls            | Artifact deletion, platform lockdown, denylist checks, and rate limits.    |

## Retired surface

The app viewer, iframe renderer, Private Link, Access Link, Share Link, Revision
Link, visibility commands, and live viewer push are retired. Their historical
database and migration structures may remain until a dedicated cleanup
migration, but they are not product features or callable routes.
