# @agent-paste/contracts

Canonical contract definitions for the MVP.

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
- `routes.ts`: MVP route registry for `api`, `upload`, `content`, and internal admin routes.

Future dashboard, MCP, Access Link lifecycle, bundle, safety warning, multi-revision, and app-layer encryption contracts are intentionally not exported by this MVP package.
