# Help Is a Table of Contents

Status: Proposed.

## Context

The agent-facing manual is spread across `/agents.md`, the repository skill,
the CLI README, `agent-paste help`, and the apex docs pages, and each carries
the same authentication, publish, and ephemeral paragraphs. Agents load all of
it up front whether or not the task needs it, and the copies drift.

The MCP surface already has the shape that works: the `initialize` response
carries a short `instructions` string and each tool description is the help
for that tool, delivered when the tool is listed.

## Decision

1. `agent-paste help` prints a table of contents: one line per command and one
   line per topic. It teaches nothing else.
2. Every command has `agent-paste help <command>`. Cross-cutting topics have
   `agent-paste help <topic>`: `auth`, `ephemeral`, `output`, and `ids`.
3. Every CLI error names the command or topic that answers it. An
   unauthenticated `publish` exits 2 and prints the exact next command,
   choosing `login --device-code` when no browser or TTY is available and
   naming `--ephemeral` as the accountless alternative.
4. `/agents.md` and the skill shrink to: what agent-paste is, how to install
   it, "run `agent-paste help`", the MCP pointer, and any taste guidance the
   CLI cannot carry (the skill's HTML-over-Markdown rule). They do not restate
   command help.
5. The apex docs pages remain the human reference and keep their current
   scope.

## Rationale

Help delivered at the moment of need costs nothing until it is needed and is
never stale relative to the binary that prints it. A table of contents lets an
agent go straight from "I need help with X" to the help for X without reading
the manual for Y. Moving the auth dance into the error path removes the
paragraph that was repeated in nine places.

## Consequences

- `apps/cli/src/help.ts` becomes a map of topic to text with one renderer, and
  `help` dispatch accepts any key in it.
- Error rendering in `render.ts` gains a `help_topic` field in the JSON error
  envelope and a trailing "See: agent-paste help <topic>" line in plain mode.
- `/agents.md` and `SKILL.md` drop to roughly a third of their current length.
- Tests assert that every command and topic has a help entry and that every
  error code maps to an existing topic; they do not pin help wording.

## Done

- `agent-paste help` lists every command and topic, and each listed key prints
  its own page.
- `agent-paste publish` with no credentials exits 2 with a next command that
  works when pasted.
- `/agents.md` and `SKILL.md` contain no command-level instructions beyond
  "run `agent-paste help`".
