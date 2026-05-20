# Unified Scope Model Across Actors

**Scopes** apply uniformly to every actor that can call `api`: a **Workspace Member** is implicitly granted every **Scope**, and an **API Key** holds a named subset. A **Member-Only Scope** subset (`manage_keys`, `manage_workspace`, `read_audit`) authorizes operations that only a **Workspace Member** can perform; member-only **Scopes** cannot be granted to an **API Key**. This collapses authorization to a single `requireScopes` middleware while preserving the asymmetry between human and agent authority that ADR 0015 establishes.

## Consequences

- One `requireScopes(scope[])` middleware serves every authenticated route in `api`. It accepts an Auth0 **Workspace Member** or a scoped **API Key** and rejects when the route's required scopes are not a subset of the actor's granted scopes.
- The auth context exposes `actor.type` (`member` or `api_key`) so handlers can branch when behavior depends on actor type without doing so for authorization checks.
- `POST /v1/api-keys` rejects any attempt to grant a member-only **Scope** to a new key, closing the privilege escalation path where a captured key could mint a broader key. The runtime check is defense-in-depth; the grant-time check is the primary defense.
- A **Workspace Member** can call agent-targeted endpoints (**Publish**, **Access Link** lifecycle, **Display Metadata** updates) without minting an ephemeral **API Key**. Audit events record `actor_type='member'` and `actor_id` as the member id.
- **Creator** attribution records the member when an **Artifact** is created from a future dashboard flow and the **API Key** when created from an agent flow. CONTEXT.md already supports this dual form.
- `audit_events.actor_type` and `idempotency_records.actor_id` cover both shapes; no per-actor-type tables.
- CONTEXT.md has been updated: the **Scope** definition is generalized, **Member-Only Scope** is introduced as a glossary term, and the relationships block adds the member-implicit-grant and member-only-scope lines.

## Considered Options

- Two parallel actor-typed middlewares (`requireMember`, `requireApiKey(scopes)`): explicit but doubles the auth surface, forces every route to opt into one path, and ambient member-overrides-everything is easy to add by accident.
- Unified scope model with member-only **Scopes**: one middleware, one rule, and the member-vs-key asymmetry expressed as data in the scope registry rather than as branching code.
