# Ephemeral publish

Ephemeral publish is the no-login form of the same one-URL publish operation.

```sh
agent-paste publish <path> --ephemeral
```

The service provisions a constrained Ephemeral Workspace, publishes the
Artifact, and returns its top-level capability `url` immediately. It also
returns a one-time claim URL so a signed-in human can move the Artifact into a
Workspace before automatic deletion.

The Artifact URL contains only its random capability hostname. The Claim Token
is carried separately in the claim URL fragment and is never sent to the
content origin.

Ephemeral Artifacts use the same production or preview hostname grammar, CSP,
R2 manifest, encryption, denylist, and content-serving path as authenticated
Artifacts. They add `noindex` headers and metadata plus the ephemeral plan's
write, size, retention, and claim limits.

An idempotent finalize replay returns the same Artifact identity and URL. A
failed capability-manifest write fails finalize rather than returning a signed
content fallback.
