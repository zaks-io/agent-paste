# pnpm, Turborepo, and Dependency Guardrails

The repository will use pnpm workspaces with Turborepo for the `apps/*` and `packages/*` monorepo. Dependency installation should require newly published package versions to be at least three days old before they are eligible for install, workspace packages should not be able to rely on undeclared transitive dependencies, and transitive dependency lifecycle scripts should not run unless explicitly allowed.

## Consequences

- The workspace should configure pnpm minimum release age to 3 days.
- The workspace should keep pnpm's strict dependency isolation and avoid hoisting settings that expose undeclared transitive dependencies.
- The workspace should disable or require approval for dependency lifecycle scripts, with explicit allowlists for packages that truly need build scripts.
- Shared packages should start with boundary-enforcing packages such as `db`, `domain`, `contracts`, `auth`, `audit`, `storage`, `config`, `sdk`, `cli`, `tsconfig`, and `eslint-config`.
- CI should use the lockfile and fail when workspace packages import dependencies they do not declare or when new dependency scripts need approval.
