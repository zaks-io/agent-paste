# Signup Auto-Provisions Personal Workspace and Default API Key

First-time Auth0 sign-in auto-provisions a **Personal Workspace**, a **Workspace Member**, and a default **API Key** with `write`, `read`, and `share` **Scopes**, all inside one `runCommand` transaction per [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md). There is no onboarding page. The plaintext **API Key** secret is returned once in the `/auth/callback` response and surfaced in the dashboard's first-run state with a copy control; it is never retrievable again, per [ADR 0043](./0043-bearer-credential-format-and-storage.md). Sign-in is rejected when Auth0 reports `email_verified=false`.

## Considered Options

- **Onboarding page that collects a workspace name and creates the key on submit.** Lower magic, captures intent. Adds a page that does nothing structural, slows time-to-first-publish, and asks for a name that is already trivially editable later. Rejected.
- **Auto-provision the workspace but not the key.** Forces users into the dashboard's API Key flow before they can publish. One extra explicit step for a key that 100% of MVP users will need. Rejected.
- **Auto-provision both, surface the secret in the dashboard on every subsequent visit until used.** Stores the plaintext beyond the callback window and breaks [ADR 0043](./0043-bearer-credential-format-and-storage.md)'s "secret never persisted" guarantee. Rejected.
- **Auto-provision both, return the secret once in the callback response, never again (chosen).** Honors the bearer storage rules: the plaintext crosses one network hop, lands in the browser, and the user copies or loses it. Lost keys are replaced through the standard create-new-key flow.

## Consequences

- **Auth callback flow.** The web app on `app.agent-paste.sh` posts the Auth0 code to `api`. `api` exchanges with Auth0, pulls `sub`, `email`, `email_verified`, `name`, refuses unverified emails, and looks up `workspace_members.auth0_sub`. On miss, one `runCommand` transaction inserts the **Workspace**, **Workspace Member**, default **Usage Policy** values, and the default **API Key** (HMAC of the secret stored per [ADR 0043](./0043-bearer-credential-format-and-storage.md)), and emits `workspace.created`, `workspace_member.added`, and `api_key.created` **Audit Events** with `actor.type='platform'`. The callback response returns the session payload plus the **API Key** plaintext.
- **Immutable join key.** `workspace_members.auth0_sub` is the unique join column. Email and display name are denormalized for display and refreshed on each login. Auth0 email change does not detach a **Workspace Member** from a **Workspace**.
- **Default state.** Workspace name defaults to `{email_local_part}'s Workspace`. Default **API Key** name is `Default`. Default **Usage Policy** uses the platform default values from the Numbers ADR.
- **Secret lifecycle.** The plaintext **API Key** secret exists in memory on `api`, in the JSON body of the callback response, and in the dashboard's first-run state. It is never written to a log, never persisted in the database, and never returned again. A user who navigates away before copying must create a new **API Key** through the normal flow; the old one can be revoked.
- **Dashboard first-run UX.** On the first dashboard load after signup, the web app renders a "your default key" card with a one-tap copy control and a short note pointing at the CLI. The plaintext is held only in the React state for that page and is discarded on navigation or refresh.
- **No multi-member, no invites.** A **Workspace** has exactly one **Workspace Member** in the MVP; sign-in cannot attach an Auth0 identity to an existing **Workspace** owned by another `sub`.
- **No demo artifact, no sample bundle.** Empty workspace is the correct first state.
- **Edge cases.** Mid-transaction failure rolls back the entire signup; the user retries from login. Auth0 connections that do not return `email_verified` are treated as unverified. Two Auth0 connections for the same person produce two **Workspaces**; account linking is out of MVP scope.
