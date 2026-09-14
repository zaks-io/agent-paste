---
name: agent-paste
description: Publish files and folders as websites with agent-paste, or revise content already published there. Prefer the CLI when shell access exists, hosted MCP otherwise. To read or download an agent-paste.link URL, fetch it directly; this skill is not needed.
---

# agent-paste

Publish a file or folder as an unguessable website that opens without login. Revising an Artifact
keeps its URL.

## Write reports as HTML

When handing a human a report, plan, review, or summary, publish HTML rather than Markdown. Use real
typography, tables, inline SVG charts, and collapsible sections. Signed-in Artifacts can run inline
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

`whoami` exits 0 even when signed out, so check `authenticated`. If false, run `login` where a
browser is available or `login --device-code` in a sandbox. Device login prints a URL and code on
stderr; keep it running until the user approves, then run `whoami` again. An `AGENT_PASTE_API_KEY`
env var also authenticates.

When login is unavailable, or the user asks for accountless publishing:

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
```

The artifact ID is the first label of the URL hostname; the full URL works too.

`edit` takes an ordered JSON array of `{ "old_string", "new_string", "replace_all"? }`. Each
`old_string` must match exactly once unless `replace_all` is set; a miss or ambiguous match fails
with exit 4. Re-read the file and correct the edit rather than replacing the whole file.

## Safety and MCP

Publish only the requested path. The CLI skips `.git`, `node_modules`, `.DS_Store`, and `.env*`,
but still check folders and report data for credentials, private source, customer data, and
unrelated files. Never put API keys, login state, or claim tokens in published content. If a publish
fails indeterminately, check whether it committed before retrying.

Without a shell, connect to `https://mcp.agent-paste.sh` over OAuth and call `whoami` first. Use
`publish_artifact`, `add_revision`, or `multi_edit`. MCP is text-only; folders, binary files, and
ephemeral publishing need the CLI. Full guide: <https://agent-paste.sh/agents.md>.
