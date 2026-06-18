/** @type {import('dependency-cruiser').IConfiguration} */
// Dependency-graph rules for the agent-paste monorepo.
//
// Two tiers of `forbidden` rules:
//   1. Baseline hygiene (cycles, orphans, unresolvable imports, dev-dep
//      leakage) - the standard `depcruise --init` set, with severities tuned
//      for this repo.
//   2. Architectural trust boundaries from docs/specs/architecture.md and
//      ADR 0006 ("small Workers by trust and scaling boundary"): apps are
//      deployment units that talk over HTTP / service bindings / queues, never
//      `import`; the `content` and `stream` Workers stay isolated from
//      Postgres / the DB.
//
// no-circular is `error`: the graph is cycle-free at runtime. The earlier
// worker-runtime / rotation / cli cycles were all closed by an `import type`
// back-edge; AP-377 broke them by extracting the shared types into leaf
// modules, so the rule now blocks any new runtime cycle.
//
// Run via `pnpm depcruise` (wrapped by scripts/depcruise-check.mjs); part of
// `pnpm verify`, so it gates CI Validate and the pre-push hook.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a runtime circular relationship. Break the cycle (dependency inversion, " +
        "single-responsibility split, or extract the shared piece into its own module - e.g. move a shared type " +
        "into a dependency-free leaf module both sides import). Type-only cycles are excluded because TypeScript " +
        "erases them.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "Orphan module - nothing imports it and it imports nothing. Either use it or remove it. " +
        "Config/declaration files and framework entrypoints are exempted below. A new entrypoint " +
        "reached only through a generated/excluded file (e.g. routeTree.gen.ts) must be added to " +
        "the pathNot exemptions, or it will fail this rule.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$", // dot files (.eslintrc.js, etc.)
          "[.]d[.]ts$", // TypeScript declaration files
          "(^|/)tsconfig[.]json$", // TypeScript config
          "(^|/)[^/.]+[.]config[.](?:js|cjs|mjs|ts|cts|mts)$", // *.config.* (vite, vitest, etc.)
          // TanStack Start entrypoints reached only through routeTree.gen.ts,
          // which is excluded above. They are framework entrypoints, not dead
          // code: src/routes/** are file-based routes, src/start.ts is the
          // Start server entry (createStart).
          "^apps/web/src/routes/",
          "^apps/web/src/start[.]ts$",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment:
        "Depends on a deprecated Node core module. Find a supported alternative. (async_hooks is intentionally " +
        "absent from this list: the repo uses the supported `node:async_hooks` form for the ALS CSP-nonce bridge.)",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: ["^(?:punycode|domain|constants|sys|_linklist|_stream_wrap)$"],
      },
    },
    {
      name: "not-to-deprecated",
      severity: "warn",
      comment:
        "Uses a deprecated npm package. Upgrade or replace it - deprecated modules are a maintenance and " +
        "security risk.",
      from: {},
      to: { dependencyTypes: ["deprecated"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "Depends on a module that cannot be resolved to disk. If it's an npm module, declare it in " +
        "package.json; otherwise fix the import path. The `cloudflare:` scheme is exempted - it is a Workers " +
        "runtime virtual module (like `node:` builtins) with no on-disk file.",
      from: {},
      to: { couldNotResolve: true, pathNot: ["^cloudflare:"] },
    },
    {
      name: "no-duplicate-dep-types",
      severity: "warn",
      comment:
        "An npm package appears under more than one dependency type in package.json (e.g. both dependencies " +
        "and devDependencies). Pick one.",
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "not-to-spec",
      severity: "error",
      comment:
        "Non-test code depends on a spec/test file. Tests test code; if a test holds something other modules " +
        "need, factor it into a shared helper.",
      from: {},
      to: { path: "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$" },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Shipped code depends on a devDependency. devDependencies are absent in production. Move the package " +
        "to dependencies, or (if this module is dev-only) widen the from.pathNot of this rule.",
      from: {
        path: "^(?:apps|packages)/[^/]+/src/",
        pathNot: "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["node_modules/@types/"],
      },
    },

    // --- Architectural trust boundaries (docs/specs/architecture.md, ADR 0006) ---
    {
      name: "not-to-app-from-package",
      severity: "error",
      comment:
        "A shared package must not import an app. packages/* are the reusable layer that apps/* consume; the " +
        "dependency only ever points package <- app. If a package needs something an app has, the boundary is " +
        "wrong - move the shared piece down into a package.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "not-to-other-app",
      severity: "error",
      comment:
        "Apps must not import each other. Each app is its own deployment unit (Worker); they communicate over " +
        "HTTP, service bindings, or queues - never a source-level import. Share code via a packages/* module " +
        "instead (ADR 0006).",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/([^/]+)/", pathNot: "^apps/$1/" },
    },
    {
      name: "content-stays-isolated",
      severity: "error",
      comment:
        "apps/content verifies signed tokens and reads R2 only - it must never reach the database or billing " +
        "(ADR 0028, docs/specs/architecture.md). Keep the untrusted-content origin minimal. (It may use the " +
        "request-id middleware from packages/auth, which is a cross-cutting helper, not WorkOS auth.)",
      from: { path: "^apps/content/" },
      to: {
        path: ["^packages/(?:db|billing)(?:/|$)", "^node_modules/(?:postgres|drizzle-orm)(?:/|$)"],
      },
    },
    {
      name: "stream-stays-isolated",
      severity: "error",
      comment:
        "apps/stream is SSE fan-out over Durable Objects only - no Postgres, R2, KV, or secrets " +
        "(docs/specs/architecture.md). It authorizes connections by calling api, not by reaching into the DB.",
      from: { path: "^apps/stream/" },
      to: {
        path: ["^packages/db(?:/|$)", "^node_modules/(?:postgres|drizzle-orm)(?:/|$)"],
      },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    exclude: {
      path: [
        "(^|/)dist/",
        "(^|/)[.]output/",
        "(^|/)[.]turbo/",
        "(^|/)[.]wrangler/",
        "(^|/)coverage/", // local coverage reports (lcov-report HTML/JS), not committed source
        "[.]gen[.]ts$",
        "worker-configuration[.]d[.]ts$",
        "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
        "(^|/)__tests__/",
        "(^|/)test/", // per-package test/ dirs (fixtures, mocks)
        "(^|/)test-helpers/", // shared test harnesses may wire multiple apps together (e2e)
      ],
    },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main"],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
