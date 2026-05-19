# Auth0 for Workspace Authentication

Human authentication will use Auth0, matching the existing workspace-level auth pattern used by the team's other apps. The MVP treats each user as having a default personal workspace with one workspace member, deferring multi-user team workspaces while keeping the workspace boundary stable for artifacts, API keys, and private access.

## Considered Options

- Build custom authentication: more control, but duplicates existing infrastructure.
- Use Auth0 at the workspace boundary: aligns with existing apps and lets the product focus on artifact sharing.
