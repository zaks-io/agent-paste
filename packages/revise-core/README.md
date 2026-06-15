# revise-core

Transport-agnostic revise engine shared by the CLI and MCP.

Responsibilities:

- `applyEdits`: literal exact-match old/new string replacement over a file body, failing fast and loud on a miss or ambiguous match.
- `RevisionReader`: the read-side seam (twin of the publish transport) so a caller injects how it reads the base Revision.
- `reviseOnePath` / `reviseWholeBody`: orchestrators that read the base, apply changes, verify the result digest, and emit a verified patch (or a no-op when the body is unchanged).
- `diffWithSelfCheck`: the unified-diff generator that applies its own diff and verifies the result digest before attaching a patch, so a generator bug degrades to a whole-blob upload rather than a finalize conflict.

The engine holds no transport, no secrets, and no I/O of its own; callers inject the read and publish seams.
