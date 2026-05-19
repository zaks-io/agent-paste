# Cloudflare Workers, R2, and Postgres via Hyperdrive

The platform will use Cloudflare Workers for the API, artifact gateway, and isolated content origin; R2 for private artifact bytes; and Postgres accessed through Hyperdrive for transactional metadata. This keeps artifact serving close to R2 while using a mature relational store for workspaces, API keys, scopes, artifacts, revisions, share links, usage policy, and audit events.

## Considered Options

- Convex: strong for reactive application state, but agents do not need reactive updates and the core system needs transactional metadata plus edge artifact serving.
- D1: operationally simple inside Cloudflare, but less proven for audit-heavy relational state and long-term scaling.
- Postgres via Hyperdrive: gives a durable relational source of truth while keeping Workers as the API and gateway layer.
