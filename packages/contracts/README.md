# @agent-paste/contracts

Canonical contract definitions for the MVP.

This package intentionally contains schemas and registries only. It does not contain HTTP handlers, database access, service clients, or runtime business logic.

## Contents

- `primitives.ts`: branded identifiers and reusable scalar shapes.
- `enums.ts`: stable enum contracts.
- `common.ts`: pagination, error, and utility schemas.
- `agentView.ts`: Manifest, Agent View, file listing, warnings, and Bundle Availability.
- `admin.ts`: operator request/response schemas.
- `artifacts.ts`: Artifact, Revision, Publish, metadata, deletion, pinning, and lockdown schemas.
- `content.ts`: non-JSON content-origin response markers.
- `uploadSessions.ts`: upload-session request and response schemas.
- `accessLinks.ts`: Access Link create, mint, list, and resolve schemas.
- `apiKeys.ts`: API Key management schemas.
- `workspace.ts`: workspace, usage policy, and whoami schemas.
- `audit.ts`: Audit Event read schemas.
- `mcp.ts`: MCP tool input/output schemas and tool registry.
- `routes.ts`: public route registry for `api`, `upload`, `content`, and operator routes.
