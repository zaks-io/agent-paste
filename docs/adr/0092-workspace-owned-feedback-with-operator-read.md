# Workspace-Owned Feedback with Operator-Only Cross-Tenant Read

We want a low-friction way to capture product **Feedback** from the people and
agents already using the platform, so day-one pain points are not lost. Two
submitters were chosen: a **Workspace Member** in the dashboard, and an
**Agent Credential** through the CLI and MCP. Both already carry an identity and a
`workspace_id`, so neither needs anonymous submission.

That leaves one structural question that is expensive to change later: **who owns a
Feedback row, and how is it read?** Feedback has two readers with opposing needs.
The operator (Isaac) wants to read _all_ Feedback across _every_ **Workspace** in
one place to spot patterns — a cross-tenant read. The submitter's **Workspace**,
under [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) RLS, can only see
its own rows. So the natural ownership key and the natural read path point in
opposite directions.

A platform-global feedback table with no `workspace_id` would make the
operator read trivial (one unscoped query) but throws away two things we get for
free: the **Contact Email** reply path (a member's email, or the owning
**Workspace**'s member email for an agent credential that has no email of its own),
and the existing RLS tenancy the rest of the schema already lives under. It would
also be the first business table to sit outside the per-**Workspace** model, a
surprising exception a future reader would have to account for everywhere.

## Decision

**A Feedback is owned by the Workspace it was submitted from, and is read for
product insight only by an Operator under the platform Run Scope.**

1. **Workspace-owned, RLS-scoped.** The `feedback` table carries a non-null
   `workspace_id` FK and is governed by the same RLS as every other tenant table
   ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)). `workspace_id` is
   both the ownership key and the **Contact Email** reply-resolution key. A
   **Workspace** sees only its own Feedback; this is not a new tenancy model.

2. **Operator read is the cross-tenant path.** The all-Workspace read lives behind
   an operator-only route in the web dashboard, resolved under the platform
   **Run Scope** exactly like the existing operator surfaces
   ([ADR 0046](./0046-operator-identity-and-web-admin-surface.md)). No new auth
   surface, no new identity. The operator view lists Feedback, shows its
   **Feedback Context** and **Contact Email**, and advances **Feedback Status**
   from `new` to `addressed`.

3. **Reply is manual; status does not send anything.** Day one captures Feedback
   and tracks triage state only. Replies are sent by hand using the captured
   **Contact Email**. There is no in-product outbound mail to submitters.

4. **One submit route, any authenticated caller.** `POST /feedback` on `api`
   requires an authenticated principal (member session or agent credential) but
   **no specific Scope** — even a `read`-only credential may file, because
   reporting friction must be the lowest-friction action there is and read-path
   pain is exactly what a read-only agent would hit. It carries `body` plus
   auto-attached **Feedback Context**; the CLI `feedback` verb, the MCP `feedback`
   tool, and the dashboard all drive this one route, keeping the agent surfaces in
   lockstep ([ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md)).

5. **Abuse bounded by reuse, not new mechanism.** The route is tagged with the
   standard authenticated **Actor Rate Limit** class
   ([ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md)) and caps
   `body` length, which bounds both row floods and the per-submit notification.

6. **Notification is the tracker-ingestion pipe, fail-soft.** On submit, `api`
   sends a Cloudflare Email Worker notification to a single verified destination on
   our own domain (`support@agent-paste.sh`), which forwards into the operator's
   external tracker (Linear today) so nothing is lost. The send is **fail-soft**:
   if it fails the Feedback row still commits. The DB row — not the email — is the
   system of record, and the operator view is the reconciliation backstop for any
   email that drops before reaching the tracker.

7. **Per-actor email throttle, suppressed-not-dropped.** The notification is capped
   per submitting actor independently of the row write. Past the cap the email is
   skipped but the row is written with a `notification_suppressed` flag, surfaced in
   the operator view — so a just-under-rate-limit flooder cannot drown the tracker,
   yet no Feedback is silently lost (the row is always there and visibly flagged).
   No batching/digest machinery.

## Consequences

- Feedback fits the existing RLS schema and the existing Operator read path; no
  table sits outside the per-**Workspace** model.
- The reply identity (**Contact Email**) falls out of ownership for free, including
  for agent submissions, which resolve to the owning **Workspace**'s member email.
- Cross-tenant reads are gated to the **Operator**: a **Workspace** can never read
  another's Feedback, and the operator read is the one declared platform-scope
  exception, consistent with lockdown and audit reads.
- The Cloudflare `send_email` binding can only target a **verified** destination in
  the same account's Email Routing. `support@agent-paste.sh` is same-domain, so
  verification is a deploy prerequisite, not a code path; if it is unverified the
  notification silently no-ops (the row still commits) until verified.
- Adding a category/type to Feedback later is a non-breaking additive migration;
  day one is free-text body only.

## Abuse response

No feedback-specific ban mechanism is added; the existing escalation ladder already
covers it, and the auth requirement makes each level apply to feedback for free:

- **Actor Rate Limit** (above) blunts a looping agent automatically and bounds the
  notification blast.
- **Agent Credential Revocation** (`api_keys.revoked_at`) kills one abusing
  credential; a revoked key gets `401` on `POST /feedback` like every route.
- **Platform Lockdown** at `Workspace` scope
  ([ADR 0040](./0040-platform-lockdown-for-operator-initiated-takedown.md)) is the
  ban hammer: it suspends every **Agent Credential** in the **Workspace** (all keys
  `401`) and blocks their content. Because `POST /feedback` requires auth, a
  locked-down **Workspace** cannot file Feedback at all and its notification pipe
  stops — no extra wiring. It is operator-only and reversible.

A lighter "feedback-muted" per-workspace state was considered and **rejected for
now**: it would silently starve the operator's tracker pipe, and the email throttle
above already protects the inbox without dropping rows. The per-actor email throttle
is the only abuse-specific control added; everything heavier reuses the platform's
existing operator levers.
