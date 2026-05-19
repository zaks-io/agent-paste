# Agent Artifact Sharing

A platform for agents to publish shareable work products that can be viewed online by humans or consumed by other agents.

## Language

**Artifact**:
A durable, addressable folder-like package containing one or more uploaded files or rendered assets.
_Avoid_: Paste, single blob, post

**Revision**:
A saved state of an **Artifact** after creation or update.
_Avoid_: Version, snapshot

**Draft Revision**:
A **Revision** that has been uploaded but is not yet visible through stable **Artifact** links.
_Avoid_: Partial update, pending files

**Published Revision**:
The **Revision** currently visible through stable **Artifact** links.
_Avoid_: Live version, current snapshot

**Revision Link**:
An immutable URL that views one specific **Revision** of an **Artifact**.
_Avoid_: Historical share link, frozen artifact link

**Bundle**:
A downloadable archive of a complete **Revision** file tree.
_Avoid_: Export, zip

**Workspace**:
The tenant that owns **Artifacts**, members, and agent credentials.
_Avoid_: Account, organization, project

**Personal Workspace**:
The default **Workspace** created for an individual human user.
_Avoid_: Personal account, user workspace

**Workspace Member**:
A human user with authenticated access to a **Workspace**.
_Avoid_: Teammate, collaborator

**Audit Event**:
A platform-controlled record of a security-relevant or lifecycle change within a **Workspace**.
_Avoid_: Log line, activity item

**Change Summary**:
The redacted structured description of what changed in an **Audit Event**.
_Avoid_: Before-and-after payload, raw diff

**Usage Policy**:
The limits a **Workspace** applies to artifact creation, revision size, retention, and API usage.
_Avoid_: Quota settings, billing limits

**Retention**:
The **Usage Policy** rules that determine how long **Artifacts** and **Revisions** are kept.
_Avoid_: Cleanup, pruning

**Deletion**:
The action that makes an **Artifact** inaccessible before its stored bytes are physically purged.
_Avoid_: Purge, archive

**API Key**:
A credential that lets an agent create and manage **Artifacts** on behalf of a **Workspace**.
_Avoid_: User token, agent token

**Creator**:
The **API Key** or workspace member that first created an **Artifact**.
_Avoid_: Owner, author

**Scope**:
A named permission that limits what an **API Key** can do within its **Workspace**.
_Avoid_: Role, capability

**Untrusted Content**:
Any file, markup, script, image, or asset uploaded into an **Artifact**.
_Avoid_: User content, agent output

**Safety Warning**:
A non-blocking notice attached to an **Artifact** or **Revision** when uploaded content appears risky.
_Avoid_: Rejection, policy violation

**Content Origin**:
The isolated web origin where **Untrusted Content** is viewed or fetched.
_Avoid_: App domain, storage URL

**Execution Policy**:
The platform-controlled browser restrictions applied when viewing **Untrusted Content**.
_Avoid_: Sandbox settings, CSP config

**Entrypoint**:
The asset within an **Artifact** that opens first when the **Artifact** is viewed.
_Avoid_: Homepage, default file, main file

**Render Mode**:
The platform-supported way an **Entrypoint** is displayed to viewers.
_Avoid_: File type, preview type

**Manifest**:
The machine-readable description of an **Artifact** and its current **Revision**.
_Avoid_: Metadata blob, config file

**Private Link**:
The authenticated URL for viewing an **Artifact** within its owning tenant.
_Avoid_: Admin link, dashboard link

**Share Link**:
A revocable, unlisted, high-entropy URL for viewing an **Artifact** without tenant authentication.
_Avoid_: Public link, permalink

**Expiration**:
The optional time after which a **Share Link** stops granting access.
_Avoid_: TTL, timeout

**Agent View**:
The machine-readable read surface exposed for an **Artifact** through a **Private Link** or **Share Link**.
_Avoid_: API preview, metadata endpoint

**Publish**:
The agent-facing action that creates or updates an **Artifact** and makes a complete **Revision** visible.
_Avoid_: Upload, deploy

**Publish Result**:
The response returned after **Publish**, containing identifiers, human-view links, agent-view links, and warnings.
_Avoid_: Upload response, API response

## Relationships

- An **Artifact** contains one or more files or rendered assets
- An **Artifact** has exactly one **Entrypoint**
- An **Entrypoint** has exactly one **Render Mode**
- MVP **Render Modes** are HTML, Markdown, text, image, audio, video, and directory
- An **Artifact** has exactly one **Manifest**
- An **Artifact** has one or more **Revisions**
- An **Artifact** has zero or one **Draft Revisions**
- An **Artifact** has exactly one **Published Revision** after first publish
- A **Revision** is a complete immutable file tree
- A **Revision** can be retrieved as a **Bundle**
- An **Artifact** belongs to exactly one **Workspace**
- An **Artifact** can have zero or more **Share Links**
- A **Private Link** resolves to the latest published **Revision** of an **Artifact**
- A **Share Link** resolves to the latest published **Revision** of an **Artifact**
- A **Revision Link** resolves to exactly one **Revision**
- **Publish** does not create a **Share Link** unless sharing is requested
- A **Share Link** grants read-only access to the **Agent View** and published **Untrusted Content**
- A **Share Link** has no **Expiration** unless one is set
- A **Workspace** has exactly one **Usage Policy**
- A **Usage Policy** controls **Retention**
- **Retention** keeps all **Revisions** unless limited by policy or manual deletion
- **Deletion** makes **Private Links**, **Share Links**, and **Revision Links** stop resolving immediately
- **Deletion** can purge stored bytes asynchronously
- A **Workspace** has one **Workspace Member** in the MVP
- A **Workspace Member** has a **Personal Workspace** by default
- A **Workspace** has zero or more **Audit Events**
- An **Audit Event** has exactly one **Change Summary**
- **Publish**, **Deletion**, **Safety Warnings**, **Usage Policy** limit hits, **API Key** changes, and **Share Link** changes create **Audit Events**
- A **Workspace** can have zero or more **API Keys**
- An **API Key** belongs to exactly one **Workspace**
- An **API Key** has one or more **Scopes**
- An **API Key** is named by a **Workspace Member**
- An **API Key** has no **Expiration** unless one is set
- An **API Key** requires a read **Scope** to read private **Artifacts**
- A **Creator** is recorded for an **Artifact** but does not own it
- Any **API Key** with the right **Scope** in the owning **Workspace** can update an **Artifact**
- Updating a known **Artifact** does not require a read **Scope**
- An **Artifact** contains **Untrusted Content**
- An **Artifact** can have zero or more **Safety Warnings**
- **Safety Warnings** can be created during **Publish** or by asynchronous scanning
- A **Manifest** is platform-controlled data, not **Untrusted Content**
- **Untrusted Content** is served from a **Content Origin**
- **Untrusted Content** is viewed under an **Execution Policy**
- The MVP uses one fixed **Execution Policy** for all **Untrusted Content**
- **Publish** returns a **Publish Result**

## Example dialogue

> **Dev:** "Can an **Artifact** contain both an HTML page and its supporting images?"
> **Domain expert:** "Yes — an **Artifact** is folder-like, so an agent can upload one file or a small set of related assets."
> **Dev:** "Does the agent always have to name the **Entrypoint**?"
> **Domain expert:** "No — infer it when obvious, but let the agent override it."
> **Dev:** "If a **Share Link** leaks, do we have to move the **Artifact**?"
> **Domain expert:** "No — revoke or rotate the **Share Link** without changing the **Private Link**."
> **Dev:** "Who owns an **Artifact** created by an agent?"
> **Domain expert:** "The **Workspace** that owns the **API Key** used by the agent."
> **Dev:** "Can trusted **API Keys** upload trusted HTML?"
> **Domain expert:** "No — **Untrusted Content** remains untrusted even when uploaded with a valid **API Key**."
> **Dev:** "Can **Untrusted Content** include JavaScript?"
> **Domain expert:** "Yes — JavaScript is allowed but remains **Untrusted Content**."
> **Dev:** "When an **Artifact** is updated, should existing links change?"
> **Domain expert:** "No — **Private Links** and **Share Links** stay stable and show the latest published **Revision**."
> **Dev:** "Can viewers see files while an update is still uploading?"
> **Domain expert:** "No — viewers only see a **Published Revision**, never a **Draft Revision**."
> **Dev:** "Can only the original **Creator** update an **Artifact**?"
> **Domain expert:** "No — update permission comes from the **API Key Scope** within the owning **Workspace**."
> **Dev:** "How does another agent inspect an **Artifact** before opening files?"
> **Domain expert:** "It reads the **Manifest**."
> **Dev:** "Is the **Manifest** just another uploaded file?"
> **Domain expert:** "No — the **Manifest** is platform-controlled data stored outside the **Untrusted Content**."
> **Dev:** "Can another agent use a **Share Link** without an **API Key**?"
> **Domain expert:** "Yes — a **Share Link** grants read-only access to the **Agent View** and published files."
> **Dev:** "Can **Untrusted Content** run on the app's own domain?"
> **Domain expert:** "No — **Untrusted Content** is viewed from a separate **Content Origin**."
> **Dev:** "Is an update a patch over the previous **Revision**?"
> **Domain expert:** "No — each **Revision** is a complete immutable file tree."
> **Dev:** "Do **Share Links** expire by default?"
> **Domain expert:** "No — a **Share Link** remains valid until revoked unless an **Expiration** is set."
> **Dev:** "Should risky-looking uploads be blocked?"
> **Domain expert:** "Not initially — attach **Safety Warnings** without blocking the upload."
> **Dev:** "Where do upload and retention limits live?"
> **Domain expert:** "They belong to the **Workspace** through its **Usage Policy**."
> **Dev:** "What is the simplest way for an agent to share a folder?"
> **Domain expert:** "It should call **Publish** and receive usable links."
> **Dev:** "What does an agent get back after **Publish**?"
> **Domain expert:** "A **Publish Result** with IDs, human-view links, agent-view links, and any **Safety Warnings**."
> **Dev:** "Does **Publish** make an **Artifact** shareable by default?"
> **Domain expert:** "No — **Publish** creates a **Share Link** only when sharing is requested."
> **Dev:** "Can private access be granted for one **Artifact** but not another?"
> **Domain expert:** "No — private access is based on **Workspace Member** access, not per-**Artifact** permissions."
> **Dev:** "How does an agent receive access?"
> **Domain expert:** "A **Workspace Member** creates a named, scoped **API Key** and gives the secret to the agent."
> **Dev:** "Can a publishing **API Key** read private **Artifacts**?"
> **Domain expert:** "Only if it has a read **Scope**."
> **Dev:** "Can an **API Key** update a known **Artifact** without reading it first?"
> **Domain expert:** "Yes — update authority comes from the write **Scope**, not the read **Scope**."
> **Dev:** "Can uploaded JavaScript call arbitrary external APIs?"
> **Domain expert:** "Not by default — the **Execution Policy** restricts external network access."
> **Dev:** "Can an agent request a custom **Execution Policy**?"
> **Domain expert:** "Not in the MVP — all **Untrusted Content** uses one fixed **Execution Policy**."
> **Dev:** "Can **Render Mode** be audio?"
> **Domain expert:** "Yes — audio is a first-class **Render Mode**."
> **Dev:** "Can **Render Mode** be video?"
> **Domain expert:** "Yes — video is a first-class **Render Mode** controlled by **Usage Policy**."
> **Dev:** "Can a viewer download the whole **Artifact**?"
> **Domain expert:** "Yes — each **Revision** can be retrieved as a **Bundle**."
> **Dev:** "How long do old **Revisions** remain available?"
> **Domain expert:** "By default, **Retention** keeps all **Revisions** unless a **Usage Policy** or manual deletion removes them."
> **Dev:** "What happens when an **Artifact** is deleted?"
> **Domain expert:** "**Deletion** makes all links stop resolving immediately, then stored bytes can be purged asynchronously."
> **Dev:** "How do we know who changed access or content?"
> **Domain expert:** "Security-relevant and lifecycle changes create **Audit Events** in the **Workspace**."
> **Dev:** "Do **Audit Events** store raw uploaded content or secrets?"
> **Domain expert:** "No — they store redacted **Change Summaries**."
> **Dev:** "Does **Publish** wait for deep content scanning?"
> **Domain expert:** "No — cheap **Safety Warnings** can be returned during **Publish**, and deeper warnings can be added asynchronously."

## Flagged ambiguities

- "artifact" was initially ambiguous between a single file and a package — resolved: an **Artifact** is folder-like and may contain multiple files or assets.
