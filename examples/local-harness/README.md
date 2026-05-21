# Local CLI Harness

Use this folder as a smoke-test fixture for the `agent-paste` CLI.

Run the full local MVP smoke test with:

```sh
pnpm smoke:local
```

For manual CLI testing, start the local API/Upload/Content harness:

```sh
pnpm dev:all
```

Then in another shell:

```sh
export AGENT_PASTE_ADMIN_TOKEN=local-admin-token
export AGENT_PASTE_ADMIN_URL=http://127.0.0.1:8787
export AGENT_PASTE_API_URL=http://127.0.0.1:8787
export AGENT_PASTE_UPLOAD_URL=http://127.0.0.1:8788

pnpm admin workspace create local@example.com --name Local --json
pnpm admin key create <workspace-id> --name local --json

export AGENT_PASTE_API_KEY=<secret-from-key-create>
pnpm cli:dev whoami --json
pnpm cli:dev publish examples/local-harness/site --title "Local harness" --ttl 7d --json
pnpm cli:dev admin artifact list --json
```

The CLI reads credentials and base URLs from the environment; it never accepts credentials as flags.
