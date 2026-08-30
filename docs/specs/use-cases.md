# Use cases

| Use case              | User need                                                                | Product behavior                                                                |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Share an agent result | Put generated HTML or a directory on the web and move on.                | Publish once and return one no-login Artifact URL.                              |
| Iterate               | Replace an Artifact without teaching recipients a new URL.               | Publish a new Revision to the same Artifact; refresh shows the latest Revision. |
| Run unattended        | Publish when no account login is available.                              | Use `--ephemeral`; return the Artifact URL plus a one-time claim URL.           |
| Use browser libraries | Run Tailwind CDN, inline scripts, modules, fetches, and workers.         | Serve the Artifact top-level under the capability CSP.                          |
| Govern output         | Delete an Artifact, expire ephemeral output, or apply platform lockdown. | Enforce the control before serving bytes and keep audit records.                |

The default handoff is always `url`. Authentication changes who owns and can
manage the Artifact, not whether the returned Artifact URL works for its
recipient.
