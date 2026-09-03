# Web

The web application is a management console. It does not render recipient
Artifacts.

## Routes

| Route                     | Authentication | Purpose                                           |
| ------------------------- | -------------- | ------------------------------------------------- |
| `/`                       | none           | Product entry and authentication handoff.         |
| `/healthz`                | none           | Worker health check.                              |
| `/dashboard`              | member         | Workspace overview.                               |
| `/artifacts`              | member         | List and manage Workspace Artifacts.              |
| `/artifacts/{artifactId}` | member         | Show metadata, Revisions, and the Artifact URL.   |
| `/keys`                   | member         | Manage agent credentials.                         |
| `/audit`                  | member         | Review audit history.                             |
| `/settings`               | member         | Manage Workspace settings.                        |
| `/billing`                | member         | Manage the plan and subscription.                 |
| `/claim`                  | member         | Claim an ephemeral publish.                       |
| `/agent-auth/claim`       | member         | Confirm provider identity for agent registration. |
| `/admin`                  | operator       | Manage platform lockdowns and workflows.          |

There are no `/v/{artifactId}` or `/al/{publicId}` routes. The Artifact detail
page links directly to `url` in a new top-level navigation. The app contains no
Artifact iframe, iframe proxy, live-viewer subscription, or Access Link
management surface.

All durable dashboard reads and writes go through `api`. The web Worker owns
session handling, SSR, and dashboard security headers only.
