# Product Judgment

This document captures the product judgment behind the narrowed MVP. It is intentionally not an implementation spec. Its job is to keep the build honest when the platform-shaped ideas start pulling scope back in.

## Why Not Build It

The main reason not to build agent-paste is scope gravity. The larger platform plan includes API, upload, content, jobs, web, MCP, CLI, WorkOS, R2, Postgres, audit, safety scanning, queues, signed links, bundles, retention, lockdown, and operator tooling. That is not a small MVP.

The category also has pressure from every side:

- Claude Artifacts already validates "AI generated thing with a share link."
- Vercel and v0 already make generated web things easy to preview and deploy.
- GitHub Gists already solve lightweight file/snippet sharing.
- S3/R2 signed URLs already solve boring storage.

"Share a thing an AI made" is not enough of a wedge.

There is also real security and abuse surface. Hosting generated HTML means dealing with untrusted scripts, phishing-shaped content, accidental secret exposure, public links, takedowns, quota abuse, and operational cleanup.

Distribution may be harder than implementation. Agents and developers will only use this if it is easier than attaching a file, pasting a gist, or deploying to an existing preview service.

## Why Build It

The underlying problem is real. Agents increasingly produce work products that are not just chat text: generated HTML demos, reports, logs, review artifacts, static sites, and bundles of files. Chat threads are a bad long-term transport for that work.

The differentiated idea is not "pastebin for AI." It is artifact handoff infrastructure:

- A CLI-first publish habit.
- Stable URLs for generated work.
- Machine-readable Agent View.
- Untrusted-content isolation by default.
- Retention so hosted cruft does not accumulate forever.
- Later room for revision links, latest links, MCP, and dashboard workflows.

The narrow MVP gives the idea a fair test without building the whole platform first.

## Honest Take

Build it, but build the CLI-first artifact handoff tool first.

Do not build the full platform until usage proves the habit. The MVP's job is one clean loop:

```text
agent creates HTML thing -> runs CLI -> gets URL -> shares it -> another agent can inspect it -> it expires later
```

Everything else earns its way in.

## Agent Adoption Risks

The tool is only useful to agents if publishing becomes the obvious low-friction move after producing an inspectable work product. The real alternative is not another polished platform; it is the agent doing whatever is fastest in the moment: pasting too much into chat, asking the human to run a local server, committing temporary files, attaching a zip, creating a gist, or deploying to an existing preview host.

Keep these risks visible while polishing:

- If auth or first-run setup feels heavy, agents will avoid the tool.
- If `publish` is slower or less reliable than a local server plus screenshot, it will not become a habit.
- If common generated artifacts exceed size, file-count, or content-type limits, agents will fall back to ad hoc sharing.
- If URLs or Agent View responses are flaky, another agent cannot depend on the handoff.
- If the human-facing view is less useful than a screenshot or local preview, the URL is not enough.
- If the product drifts toward permanent hosting, it will compete with stronger deployment tools instead of owning transient handoff.
- If the machine-readable Agent View is underdeveloped, the product collapses back toward generic pastebin behavior.

The wedge should be judged by whether an agent naturally thinks: "I made a thing; publish it; share the URL." Anything that interrupts that reflex weakens the product.

## Product Rules

- Prefer a working hosted publish loop over completeness.
- Keep public CLI auth API-key only until OAuth is obviously needed.
- Keep admin operations internal until repeated workflows demand UI.
- Keep one revision per artifact until updates are a real use case.
- Use direct signed content URLs for MVP, then move to fragment-based links later.
- Include retention from day one.
- Treat artifacts as transient handoffs, not hosted assets. Keep read and concurrent-viewer ceilings low; high-traffic hosting belongs on a real host, not here.
- Do not let MCP, dashboard, bundles, or link lifecycle sneak into Phase 1.
