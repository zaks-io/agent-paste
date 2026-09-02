---
name: agent-paste
description: Publish files, folders, reports, demos, and generated artifacts as websites with agent-paste. Use when an agent needs to hand work to a human through a URL, revise an existing Artifact, or read or edit published content. Prefer the agent-paste CLI when shell access is available and the hosted MCP server otherwise.
---

# agent-paste

Publish a file or folder as an unguessable, no-login website. Revising an Artifact updates the
same stable URL.

## Publish

Use `agent-paste` if installed, otherwise run commands through `npx @zaks-io/agent-paste`. Use
`--json` for agent-consumed output and inspect `--help` instead of inventing flags.

```sh
agent-paste whoami --json
agent-paste publish <path> --json
```

`whoami` exits 0 when signed out, so inspect `authenticated`. If false and browser authentication
is possible, run `agent-paste login`. Otherwise, or when the user requests accountless publishing:

```sh
agent-paste publish <path> --ephemeral --json
```

Preserve a caller-provided `--claim-code <clm_...>`. Return the result's `url`; it is the Artifact
and opens without login. For ephemeral results, return `claim_url` only for the optional keep and
ownership step. Ephemeral HTML is static until claimed: scripts, connections, forms, frames,
objects, and workers are blocked. Service workers remain blocked after claim. Do not seek a
separate share link, viewer URL, or visibility command.

## Revise instead of republishing

```sh
agent-paste publish <path> --artifact-id <artifact-id> --json
agent-paste pull <artifact-id> <remote-path> --json
agent-paste edit <artifact-id> <remote-path> --edits <edits.json> --json
```

`edit` accepts an ordered JSON array of `{ "old_string", "new_string", "replace_all"? }`. If a
literal match is absent or ambiguous, re-read and correct it. Never silently replace the whole
file. Confirm the returned `artifact_id` and stable `url` after every update.

## Safety and MCP

Publish only the requested path. Check folders for credentials, private source, and unrelated
files even though the CLI excludes common secret paths. Never expose API keys, login state, claim
tokens, or credential files. Do not retry an indeterminate publish unless the CLI or read-back
proves whether it committed.

Without shell access, connect to `https://mcp.agent-paste.sh` with OAuth and run `whoami` first.
Use `publish_artifact`, `add_revision`, or `multi_edit`. MCP is text-only; use the CLI for folders,
binary files, and accountless publishing. Full docs: <https://agent-paste.sh/agents.md>.
