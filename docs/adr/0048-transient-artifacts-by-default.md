# Transient Artifacts by Default

Status: Accepted. Renumbered from duplicate ADR 0032.

Stored content is treated as transient by default to prevent the platform from drifting into general-purpose web hosting and to keep storage cost bounded. The platform enforces three composable mechanisms: **Auto Deletion** removes published **Artifacts** thirty days after their most recent **Publish**, **Pinning** lets a **Workspace Member** exempt a small number of **Artifacts** from **Auto Deletion**, and the **Artifact Rate Limit** throttles unauthenticated read traffic against a single **Artifact**.

## Considered Options

- **Indefinite storage with manual deletion.** Simplest UX, but converts the platform into hosting and exposes the business to unbounded storage cost.
- **User-tunable retention up to a long ceiling.** Surfaces user choice but invites the same hosting drift; the platform default becomes the de facto policy regardless of the ceiling.
- **Aggressive default cleanup with a small exemption mechanism.** Selected — keeps the storage surface bounded, sets agent-transient expectations, and leaves a clean upgrade path to paid tiers that raise the cap.

## Consequences

- The platform default for **Auto Deletion** is thirty days. **Workspaces** can configure shorter values (minimum one day) but cannot exceed the platform cap in the MVP.
- **Auto Deletion** counts age from the **Artifact**'s most recent **Publish**; passive serving does not extend lifetime.
- **Auto Deletion** triggers **Deletion**, which immediately stops links from resolving, emits an **Audit Event**, and asynchronously purges stored bytes.
- **Auto Deletion** does not apply to **Unpublished Artifacts**; those remain governed by **Upload Cleanup**.
- **Pinning** is a dashboard-only action restricted to **Workspace Members**; **API Keys** cannot pin regardless of **Scope**.
- The default **Pinned Artifact** cap is fifty per **Workspace** and is platform-controlled and operator-tunable.
- **Pinning** is rejected when the **Workspace** is at its cap; users must unpin to free a slot.
- **Pinning** and unpinning emit **Audit Events**.
- The **Artifact Rate Limit** applies per **Artifact** across **Access Link** reads and **Content Origin** requests; **Private Link** and **Agent View** reads are not counted.
- The default **Artifact Rate Limit** is approximately sixty requests per minute; exceeding it returns HTTP 429 with `Retry-After`.
- The **Artifact Rate Limit** is not exposed through **Usage Policy** in the MVP and is not workspace-tunable.
- A future paid tier can raise the **Auto Deletion** cap, lift the **Artifact Rate Limit**, and adjust the **Pinned Artifact** cap without changing the underlying mechanisms.
