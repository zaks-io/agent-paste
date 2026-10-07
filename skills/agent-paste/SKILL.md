---
name: agent-paste
description: Publish files and folders as websites with agent-paste, or revise content already published there. Prefer the CLI when shell access exists, hosted MCP otherwise. To read or download an agent-paste.link URL, fetch it directly; this skill is not needed.
---

# agent-paste

Publish a file or folder as an unguessable website that opens without login. Revising an Artifact
keeps its URL.

## Write reports as HTML

When handing a human a report, plan, review, or summary, publish HTML rather than Markdown. Use real
typography, tables, inline SVG charts, and collapsible sections. Claimed Artifacts can run inline
scripts, the Tailwind browser CDN, and HTTPS libraries; ephemeral Artifacts block scripts and
network, so keep those static. Lead with the finding, keep the supporting data on the page, and open
the URL once before handing it over.

## Publish

Use `agent-paste` if installed, otherwise `npx @zaks-io/agent-paste`. Pass `--json` when you will
parse the output. Run `--help` for flags.

```sh
agent-paste whoami --json
agent-paste publish <path> --json
```

`whoami` exits 0 with `authenticated: false` when no usable local credential exists. A successful
response identifies the Workspace, actor, and scopes; older CLI versions omit `authenticated`
on success. Publish directly after a successful response. An injected `AGENT_PASTE_API_KEY`
needs no login. Keep the inherited environment; never print the key or pass it as a command argument.

For headless setup, the user creates a key at <https://app.agent-paste.sh/keys> and injects its
one-time secret as `AGENT_PASTE_API_KEY` through sandbox or CI secret configuration. A non-empty
key takes precedence over saved login. Invalid, revoked, expired, or wrong-environment keys fail
with exit 2, without trying saved login. Correct or remove the environment key before retrying.
HTTP server failures exit 6; transport failures exit 1. Neither means the agent is signed out.

If `authenticated` is false, run `login` where a browser is available or `login --device-code`
in a sandbox. Device login prints a URL and code on stderr; keep it running until the user
approves, then check `whoami` again. `logout` attempts to revoke and removes the saved login;
it leaves the environment key untouched.

Use accountless publishing when no authenticated path is available and static output meets the
task, or when the user asks for it. `--ephemeral` explicitly ignores both environment and saved
credentials. Do not switch to it automatically after an authentication failure:

```sh
agent-paste publish <path> --ephemeral --json
```

Keep any `--claim-code <clm_...>` the user's instructions include. Return `url`; it is the Artifact.
Return `claim_url` too if the user wants to keep the Artifact. Ephemeral HTML is static until
claimed: scripts, fetch, forms, frames, and workers are blocked. Service workers stay blocked after
claim.

## Revise instead of republishing

```sh
agent-paste publish <path> --artifact-id 01234-56789-abcde-fghjd --json
agent-paste pull 01234-56789-abcde-fghjd <remote-path> --json
agent-paste edit 01234-56789-abcde-fghjd <remote-path> --edits <edits.json> --json
agent-paste download 01234-56789-abcde-fghjd --output <file.zip> --json
```

The artifact ID is the first label of the URL hostname. The `art_...` `artifact_id` from JSON output
and the full URL work too.

`edit` takes an ordered JSON array of `{ "old_string", "new_string", "replace_all"? }`. Each
`old_string` must match exactly once unless `replace_all` is set; a miss or ambiguous match fails
with exit 4. Re-read the file and correct the edit rather than replacing the whole file.

`download` saves the revision as a zip. It waits up to a minute while the zip is built, then exits
6; retry later.

## Safety and MCP

Publish only the requested path. The CLI skips `.git`, `node_modules`, `.DS_Store`, and `.env*`,
but still check folders and report data for credentials, private source, customer data, and
unrelated files. Never put API keys, login state, or claim tokens in published content. If a publish
fails indeterminately, check whether it committed before retrying.

Without a shell, connect to `https://mcp.agent-paste.sh` over OAuth and call `whoami` first. MCP
cannot use `AGENT_PASTE_API_KEY` or saved CLI credentials. Use
`publish_artifact`, `add_revision`, or `multi_edit`. MCP is text-only; folders, binary files, and
ephemeral publishing need the CLI. Full guide: <https://agent-paste.sh/agents.md>.
