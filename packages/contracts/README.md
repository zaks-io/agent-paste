# @agent-paste/contracts

Canonical contract definitions for the hosted service.

This package intentionally contains schemas and registries only. It does not contain HTTP handlers, database access, service clients, or runtime business logic.

## Contents

- `primitives.ts`: branded identifiers and reusable scalar shapes.
- `enums.ts`: stable enum contracts.
- `common.ts`: pagination, error, and utility schemas.
- `agentView.ts`: public MVP Agent View with full per-file signed URLs.
- `admin.ts`: internal operator workspace, cleanup, and operation-event schemas.
- `artifacts.ts`: admin artifact schemas.
- `uploadSessions.ts`: upload-session create/finalize schemas and MVP Publish Result.
- `apiKeys.ts`: admin-created API Key schemas.
- `workspace.ts`: workspace, usage policy, and whoami schemas.
- `routes.ts`: route registry for `api`, `upload`, `content`, web dashboard, billing, and operator routes.
- `mcp.ts`: MCP OAuth scopes, JSON-RPC transport shapes, twelve-tool registry, error mapping, and forwarded API call plans (ADR 0061).
