# Use Cases

This document is the canonical use-case record for agent-paste. Marketing pages,
README copy, and launch material should summarize this file instead of inventing
new use-case lists.

agent-paste is for moments where an agent made something inspectable and the
next step should be a link, not a deploy.

## Core Loop

```text
agent creates something -> publish -> human opens URL -> agent reads Agent View -> Artifact expires later
```

The loop is useful only when publishing is faster than the ad hoc alternatives:
pasting into chat, attaching a zip, asking a human to run a local server,
committing temporary files, creating a gist, or deploying to a preview host.

## Primary Use Cases

| Use case                    | User moment                                                                                                  | Product job                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Publish one generated asset | An agent produced a report, dashboard, prototype, log, or small static site worth inspecting.                | Turn a file or folder into an Artifact with an authenticated app View, explicit sharing, and Agent View. |
| Open remote output anywhere | A remote agent finished while the operator is away from their desk.                                          | Return a URL that opens on any device without requiring a repo, local server, or deploy project.         |
| Publish without CLI access  | A hosted agent can connect to remote MCP but cannot install packages, run shell commands, or use a keychain. | Expose OAuth-only MCP tools that publish text Artifacts, read Agent Views, and manage links.             |
| Watch an agent iterate      | An agent is refining the same work product across multiple publishes.                                        | Let an open viewer advance to the latest Published Revision when Live Updates are available.             |
| Hand off between tools      | Work made in one agent tool needs to move to a human or another agent in another tool.                       | Provide a human browser view and a machine-readable Agent View so the next tool does not scrape.         |
| Share a one-off artifact    | Generated work needs to be dropped into a channel, issue, PR, or customer thread for review.                 | Host the handoff without turning it into permanent hosting or a social surface.                          |
| Run unattended              | An agent has no stored credential and no human available for browser login at publish time.                  | Allow `--ephemeral` publish, return the immediate `unlisted_url`, and let a human claim it later.        |
| Govern agent output         | A team needs to know what agents published, when it expires, and how to revoke access if needed.             | Attach Artifacts to Workspaces, Access Links, Audit Events, Auto Deletion, and lockdown controls.        |
| Embed artifact handoff      | A product needs artifact storage and a manifest protocol without building the whole platform itself.         | Expose CLI, MCP, Agent View, and documented contracts that can be built on by another platform.          |

For the iteration use case, authenticated no-login shareable browser URLs must
come from an explicit unlisted Share Link, minted by the separate
`set-visibility unlisted` step (`agent-paste set-visibility <artifact-id>
unlisted`, MCP `set_visibility` with `visibility: "unlisted"`). Accountless
`--ephemeral` publish is the exception: it auto-creates that unlisted Share Link
and returns `unlisted_url` immediately. The direct
`revision_content_url` is exact Revision content; it is useful for one-shot
inspection but it does not advance when the agent publishes a later Revision.
The `private_url` (`/v/<artifactId>` clean viewer) is the default authenticated
Workspace view publish returns.

## Primary Audiences

| Audience                      | Why they care                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Agents                        | They need a stable place to put work, including from hosts with no CLI access, and a stable way to read another agent's work. |
| Agent builders and developers | They need one publish command or MCP tool, scoped credentials, no storage bucket, and no deploy infra to babysit.             |
| Teams                         | They need auditability, revocation, retention, Live Updates, and controls around agent output.                                |
| Embedders and platforms       | They need a vendor-neutral artifact layer and Agent View protocol they can build on.                                          |

## Out Of Scope

These are not agent-paste use cases:

- Production hosting for long-lived, high-traffic sites.
- Permanent storage or archival backup.
- Social discovery, feeds, comments, stars, or public profiles.
- Generic file hosting with no Agent View or Artifact model.
- A model-vendor-specific artifact surface.
