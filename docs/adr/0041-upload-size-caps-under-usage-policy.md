# Upload Size Caps Under Usage Policy

Four platform-controlled size limits — **File Size Cap**, **File Count Cap**, **Revision Size Cap**, and **Bundle Size Cap** — sit under **Usage Policy** alongside the rate-limit caps from ADR 0039. They bound the resource envelope of one **Revision** at three enforcement points: the signed upload-worker PUT URL, the **Upload Session** finalize step, and the **Bundle** generation job. Exceeding **Bundle Size Cap** does not fail the **Publish**; the **Bundle Availability** transitions to failed and the **Revision** remains visible. Defaults are absolute byte counts, not ratios.

## Considered Options

- **No model-level caps; rely on R2/Worker defaults.** Cheapest, but agents have no contract to code against, and one runaway agent can fill a workspace's storage budget or feed the queue a multi-gigabyte bundle in a single request.
- **Ratio-based Bundle Size Cap (e.g., 3× revision size).** Elegant in that small artifacts get small caps, but harder to alert on, harder for agents to predict, and the failure mode looks different at every scale. Rejected.
- **Caps inside Usage Policy with absolute values (chosen).** Composes with the rate-limit caps already in ADR 0039. Predictable, easy to alert on, easy to surface in errors.

## Consequences

- **CONTEXT.md** adds **File Size Cap**, **File Count Cap**, **Revision Size Cap**, and **Bundle Size Cap** as glossary terms and extends the **Usage Policy** definition to enumerate them. The informal "revision size" wording in earlier ADRs is now covered by **Revision Size Cap**.
- **Three enforcement points**:
  - **File Size Cap** is signed into the upload-worker PUT URL as `Content-Length` per ADR 0027. `upload` rejects oversized PUTs before bytes hit R2.
  - **File Count Cap** and **Revision Size Cap** are checked at **Upload Session** creation as a friendly pre-flight and again at finalize as hard enforcement inside `runCommand`. Exceeding either at finalize fails the finalize; uploaded bytes are reclaimed by **Upload Cleanup**.
  - **Bundle Size Cap** is checked by the `bundle-generate` handler. Exceeding it transitions `bundle_status='failed'` per ADR 0050 (bundle availability) with an op-log reason. The **Revision** is otherwise unaffected and remains visible.
- **Publish does not wait on Bundle Size Cap.** Per ADR 0050 the **Bundle** is async; a **Publish** with a too-large **Bundle** still succeeds and returns a **Publish Result** whose `bundle.status` becomes `failed` shortly after. Agents that need the **Bundle** consult the **Agent View** for the status.
- **Workspace can lower, platform sets the ceiling.** Same pattern as **Auto Deletion**. The MVP exposes no per-workspace override surface; platform defaults apply uniformly.
- **Defaults are not in this ADR.** Actual byte values are tuned during MVP rollout. The model fixes their existence; the numbers are operational. Every upload route must enforce a non-infinite cap from day one.
- **Error surfacing.** Cap violations use the error envelope from ADR 0036 with distinct codes (`file_size_cap_exceeded`, `file_count_cap_exceeded`, `revision_size_cap_exceeded`, `usage_policy_exceeded`) so agents and operators can tell the failure mode at a glance.
- **No Audit Event for cap violations.** They are operational errors, not security-relevant lifecycle events. Sustained violations feed into the abuse-response surface from ADR 0040 (platform lockdown) if a workspace persistently probes the ceiling.
- **Cap discovery.** The CLI and SDK display caps to humans and agents through the error envelope at violation time. Pre-flight discovery of cap values is out of scope for the MVP; agents treat caps as discoverable through failed attempts, not through a query endpoint.
