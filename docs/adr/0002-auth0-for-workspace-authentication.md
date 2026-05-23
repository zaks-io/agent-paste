# Auth0 for Workspace Authentication

Status: Superseded for `apps/web` by [ADR 0068](./0068-workos-authkit-for-web-app-auth.md). CLI ([ADR 0060](./0060-cli-authentication-via-auth0-loopback.md)) and MCP ([ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md)) human-auth provider decisions remain open and will be re-decided when those surfaces are implemented.

Human authentication will use Auth0, matching the existing workspace-level auth pattern used by the team's other apps. The MVP treats each user as having a default personal workspace with one workspace member, deferring multi-user team workspaces while keeping the workspace boundary stable for artifacts, API keys, and private access.

## Considered Options

- Build custom authentication: more control, but duplicates existing infrastructure.
- Use Auth0 at the workspace boundary: aligns with existing apps and lets the product focus on artifact sharing.
