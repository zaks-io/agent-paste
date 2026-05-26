# Admin Operations Spec

The MVP has no admin UI. Operations happen through a repo-local admin CLI that wraps internal REST APIs. This lets Codex help manage the hosted service without building a dashboard before the publish loop is proven.

## Principles

- Admin tooling is internal, boring, and scriptable.
- The admin CLI is not a public product surface.
- Admin commands use `AGENT_PASTE_ADMIN_TOKEN`.
- Public API keys never authorize admin routes.
- Destructive commands require an explicit confirmation flag.
- Admin outputs must avoid signed content URLs and secret material unless the command creates a new secret that must be shown once.

## Environment

```sh
AGENT_PASTE_ADMIN_TOKEN=...
AGENT_PASTE_ADMIN_BASE_URL=https://api.agent-paste.sh
```

`AGENT_PASTE_ADMIN_BASE_URL` defaults to production unless local/preview commands override it.

## Commands

### Workspace

```sh
pnpm admin workspace create --email user@example.com [--name "Isaac"]
pnpm admin workspace list
```

`workspace create` creates a workspace record and records an operation event. The email is operator-supplied metadata in the MVP; public OAuth-backed membership is future work.

### API Keys

```sh
pnpm admin api-key create --workspace <workspace_id> --name "default"
pnpm admin api-key revoke <api_key_id> --yes
```

`api-key create` prints the plaintext API key once. The service stores only derived secret material.

### Artifacts

```sh
pnpm admin artifacts list [--workspace <workspace_id>] [--status active|deleted|expired]
pnpm admin artifacts inspect <artifact_id>
pnpm admin artifacts delete <artifact_id> --yes
```

`inspect` shows metadata, file list, size, expiry, status, and relevant operation event ids. It should not print signed content URLs by default.

### Cleanup

```sh
pnpm admin cleanup run [--dry-run]
```

Cleanup expires artifacts, removes abandoned upload sessions, writes operation events, and deletes eligible R2 bytes. `--dry-run` reports counts without mutation.

### Operation Events

```sh
pnpm admin events list [--workspace <workspace_id>] [--artifact <artifact_id>] [--limit 50]
```

Events are lightweight operational records that can grow into a fuller audit log later.

## Admin REST Routes

See [`api.md`](./api.md#admin-routes) for the route table.

Admin REST APIs must:

- Require `Authorization: Bearer <AGENT_PASTE_ADMIN_TOKEN>`.
- Reject public API keys.
- Redact secrets from logs and events.
- Attach or generate `X-Request-Id`.
- Record operation events for mutations.
- Return machine-readable JSON errors.

## Destructive Safety

Commands that revoke credentials, delete artifacts, or run mutating cleanup require `--yes`. The CLI should print what will be affected before failing for missing `--yes`.

Example:

```sh
pnpm admin artifacts delete art_123
```

Expected result:

```text
Refusing to delete art_123 without --yes.
```

## Future Replacements

Later phases may replace the single admin token with WorkOS, Cloudflare Access, or operator identities. The CLI should isolate auth handling so this change does not rewrite every command.
