# agent-paste

Command-line interface for publishing shareable **Artifacts** as an agent. The CLI is the agent-facing wrapper around the public REST API; see [ADR 0017](../../docs/adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md) for why there is no separately published SDK.

## Install

No install required. The canonical invocation is:

```sh
npx agent-paste publish <path>
```

For repeated use:

```sh
npm install -g agent-paste
```

## Authenticate

Set `AGENT_PASTE_API_KEY` in the environment. Create a key with `write`, `read`, and `share` **Scopes** at `https://agent-paste.sh/keys`.

```sh
export AGENT_PASTE_API_KEY=ap_...
```

The CLI does not read on-disk config and does not accept the key as a flag. The key encodes its **Workspace**, so nothing else needs to be configured.

## Publish

A folder:

```sh
npx agent-paste publish ./report
```

A single file (treated as a one-file **Artifact**):

```sh
npx agent-paste publish ./report.html
```

With a **Share Link** created during publish:

```sh
npx agent-paste publish ./report --share
```

A new **Revision** on an existing **Artifact**. The **Private Link** and any existing **Share Link** keep working and now resolve to the new Revision:

```sh
npx agent-paste publish ./report --artifact art_01H...
```

## Flags

| Flag | Purpose |
|------|---------|
| `--artifact <id>` | Add a new **Revision** to an existing **Artifact**. Default: create a new Artifact. |
| `--share` | Create a **Share Link** during publish. Default: off. |
| `--no-share` | Suppress Share Link creation. Default behavior; flag exists for clarity in scripts. |
| `--title <text>` | Set **Display Metadata** title. Default: path basename. |
| `--entrypoint <path>` | Override the inferred **Entrypoint**. Must be a file inside the upload. |
| `--render-mode <mode>` | Override the inferred **Render Mode**. One of: `html`, `markdown`, `text`, `image`, `audio`, `video`, `directory`. |
| `--json` | Emit the **Publish Result** as JSON on stdout. Stdout becomes pure JSON. |
| `--quiet` | Suppress stderr progress output. |
| `--progress` | Force progress output even when stderr is not a TTY. |

## Output

Default human-readable output:

```
Published artifact art_01H... revision rev_01H...

  Revision:   https://agent-paste.sh/r/xyz789
  Private:    https://app.agent-paste.sh/artifacts/art_01H...
  Agent View: https://api.agent-paste.sh/v1/artifacts/art_01H.../agent-view
  Bundle:     pending
```

With `--share`, the output also lists the **Share Link**. If the publish attached **Safety Warnings**, they appear at the bottom under a `Safety:` header. Asynchronous Safety Warnings created after publish are not visible here; fetch the **Agent View** to see them.

With `--json`, stdout is exactly the Publish Result:

```json
{
  "artifact_id": "art_01H...",
  "revision_id": "rev_01H...",
  "private_link": "https://app.agent-paste.sh/artifacts/art_01H...",
  "revision_link": "https://agent-paste.sh/r/xyz789",
  "share_link": null,
  "agent_view_link": "https://api.agent-paste.sh/v1/artifacts/art_01H.../agent-view",
  "bundle": { "status": "pending" },
  "safety_warnings": []
}
```

## Inference

- **Entrypoint** for a folder is the first match of `index.html`, `index.md`, `README.md`, or the single file if the folder contains exactly one. Otherwise publish fails; pass `--entrypoint`.
- **Render Mode** is inferred from the Entrypoint extension. Override with `--render-mode`.

## Excluded by default

The CLI silently excludes these from any folder upload and prints the excluded set to stderr:

- `.git/`
- `.DS_Store`
- `node_modules/`
- `.env`, `.env.*`

The exclusion list is not configurable in v1. If you need one of these in the upload, build a folder without it.

## Idempotency and retries

The CLI generates an **idempotency key** per `publish` invocation and reuses it across automatic retries. The API deduplicates retried calls, so transient network failures cannot produce duplicate Artifacts or Revisions.

Transient failures (network errors, 5xx, 504, 429 with `Retry-After`) are retried up to 3 times with 1s/2s/4s backoff. Non-transient failures (4xx) exit immediately. An expired **Upload Session** exits cleanly; re-run `publish` to start over.

## Errors

Exit `0` for success, `1` for any failure. Plain text on stderr:

```
agent-paste: missing AGENT_PASTE_API_KEY. Create a key at https://agent-paste.sh/keys
```

With `--json`, errors are structured on stderr:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "Key has scopes [write], needs [write, read, share]",
    "docs": "https://agent-paste.sh/docs/scopes"
  }
}
```

The `code` field is the stable identifier; `message` is human-readable.

## When not to use the CLI

The CLI assumes `npx` is available. For non-Node environments (Python or Go agents, server-to-server callers, sandboxes without npm access), use the public REST API directly at `https://api.agent-paste.sh/v1`. Lower-level **Upload Session** endpoints are public and documented in the OpenAPI spec.
