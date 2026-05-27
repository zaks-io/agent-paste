# Preview and Production Environments Only

The MVP will support preview and production environments, without a long-lived staging environment. Pull request previews provide validation before merge, and production is protected through CI, GitHub Environment approval, migrations, and environment-scoped credentials.

## Consequences

- Runtime secrets live in Cloudflare per environment.
- Deployment credentials and migration database URLs live in GitHub Environment secrets.
  PR preview deploys use one GitHub Environment named `Preview`; individual
  Cloudflare, Neon, Hyperdrive, and queue resources remain PR-scoped so PRs stay
  isolated without creating one GitHub Environment per PR.
- Preview uses preview/staging WorkOS credentials and preview-scoped database and R2 resources.
- Production uses production WorkOS credentials, production Postgres, and production R2 resources.
- The repository should include examples for required environment variables but should not commit real `.env` files.
