# MVP

The MVP is one operation: publish files and receive one URL that works.

```sh
agent-paste publish ./output
```

Human output prints the Artifact URL. JSON output is:

```json
{
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "output",
  "url": "https://0123456789abcdef0123456789abcdef.agent-paste.sh/",
  "expires_at": null
}
```

The URL opens without login and without an app viewer. Publishing again to the
same Artifact preserves the URL and advances it to the new Revision.

Accountless agents use:

```sh
agent-paste publish ./output --ephemeral
```

The Artifact URL works immediately. Ephemeral output also carries claim data
for the optional ownership transfer, but claim credentials are never included
in the Artifact URL.

The MVP supports HTML, CSS, JavaScript, images, data files, and multi-file
directories. It intentionally treats Artifact HTML as untrusted code on a
separate capability origin and prevents the management app from embedding it.
