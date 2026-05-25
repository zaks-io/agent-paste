# Agent-Paste Competitor Analysis

Date: 2026-05-25

This report compares agent-paste against adjacent products that solve parts of the same handoff problem: pastebins, temporary file hosts, deploy-preview/static hosting platforms, browser code sandboxes, and AI-native artifact sharing.

## Agent-Paste Baseline

Agent-paste is best understood as hosted artifact handoff infrastructure for agents, not as a generic pastebin.

Current product posture from the local specs/status:

- CLI/API-first publish flow for generated HTML files or folders with `index.html`.
- Hosted Cloudflare Workers architecture with separate API, upload, and content origins.
- API-key publishing, with WorkOS dashboard/CLI login now implemented in Phase 3 work.
- Publish result returns a browser `view_url` plus a signed `agent_view_url` JSON manifest with per-file URLs.
- Untrusted content is served from an isolated content origin, private R2, fixed extension-derived content types, CSP, no direct R2 URLs, and no token/full-URL logging.
- Retention is default behavior: default TTL `30d`, min `1d`, max `90d`; no forever retention in the MVP posture.
- MVP caps: `10 MB` max file, `25 MB` max artifact, `100` files per artifact, API-key actor rate target `60 requests/minute`, workspace burst cap currently represented in contracts as `300 requests/minute`.
- Future direction: revision links, latest-moving share links, Access Links, bundles, MCP, safety scanner, app-layer encryption, billing.

## Executive Summary

There is no exact public equivalent to agent-paste. The closest products each own one slice:

- GitHub Gist, Pastebin, Pastes.io, Rentry, and PrivateBin are text/snippet sharing tools.
- file.io, tmpfiles.org, 0x0.st, and transfer-style services are temporary file handoff tools.
- Vercel, Netlify, Cloudflare Pages, Replit, CodeSandbox, and StackBlitz are preview/deploy/code-environment platforms.
- Claude Artifacts, ChatGPT Canvas/shared links, and v0 are AI-native creation/sharing surfaces inside a single model vendor ecosystem.

The likely wedge is narrow but real: **agent-generated multi-file work products that need a one-command publish, a human browser URL, a machine-readable manifest for another agent, explicit TTL cleanup, and untrusted-content isolation without becoming a full deploy platform.**

The weakest positioning is "Pastebin for agents." That phrase points buyers toward mature free tools. The stronger positioning is "transient artifact handoff for agents and CI."

## Recommendation

Keep agent-paste narrow. Do not compete as a pastebin, temporary file host, browser IDE, or deploy platform.

The most defensible product position is:

> Transient artifact handoff for agents.

The core promise should remain:

```sh
agent-paste publish ./artifact --ttl 7d
```

That command should reliably produce:

- a human browser URL,
- an agent-readable manifest URL,
- automatic expiration,
- isolated untrusted-content serving,
- workspace/API-key ownership,
- enough audit/admin control for team use.

The gap is not "share text" or "host a static site." Those jobs are already filled by GitHub Gist, Pastebin-style tools, file.io/Wormhole/tmpfiles, Cloudflare Pages, Netlify, Vercel, Replit, CodeSandbox, StackBlitz, and AI-native sharing surfaces.

The gap is:

> When an agent produces a thing too rich for chat but too temporary for deployment, agent-paste gives it a safe URL and a machine-readable manifest.

This is the area competitors do not cleanly fill. The closest substitutes each miss a key part:

- Gist is excellent for code/text but weak for generated HTML artifact viewing, explicit TTL, folders, and untrusted-content isolation.
- file.io, Wormhole, tmpfiles.org, and 0x0.st are good at file transfer but weak on artifact semantics, workspace identity, auditability, and agent-readable manifests.
- Vercel, Netlify, Cloudflare Pages, Replit, CodeSandbox, and StackBlitz are good when the output should become a project, app, branch preview, or production deployment; they are too heavyweight for one-off agent handoff.
- Claude Artifacts, ChatGPT Canvas/shared links, and v0 prove demand for AI-generated shareable work, but they are ecosystem-bound and not designed as vendor-neutral cross-agent protocol surfaces.

Immediate product emphasis:

1. Make `agent_view_url` the differentiator. Treat it as the protocol surface, document it prominently, and keep it stable.
2. Keep limits modest and explicit. Do not chase file.io-sized transfers or deploy-platform traffic. Agent-paste should handle review artifacts, generated reports, prototypes, logs, and small static bundles.
3. Lean into TTL as a feature. "Your agent artifacts do not live forever by accident" is a credible team/ops message.
4. Target agent workflows before human-first polish. Add first-party examples for Codex, Claude Code, Cursor, GitHub Actions, and CI pipelines.
5. Avoid "pastebin" positioning. Prefer "artifact handoff for agents," "temporary publish URLs for agent-generated work," or "a shareable output layer for coding agents."

## Competitive Matrix

| Product                       | Category                             | Pricing / limits found                                                                                                                                                                                                                                                                                                                                                                             | Overlap with agent-paste                                                        | Agent-paste advantage                                                                                                               | Competitor advantage                                                                            |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub Gist                   | Code snippet / mini Git repo         | Free with GitHub account. Public or secret gists. REST API returns up to 1 MB inline content per file; files larger than 10 MB require cloning; file list may truncate after 300 files.                                                                                                                                                                                                            | Multi-file code/text sharing, CLI/API access through GitHub tooling, revisions. | Purpose-built artifact TTL, Agent View manifest, isolated HTML content origin, no GitHub identity/repo mental model required.       | Existing developer habit, Git history, free, search/discovery, comments/forks/stars.            |
| Pastebin                      | Classic pastebin                     | Free/Pro. Max paste size 512 KB free/guest, 10 MB Pro. Guest 10 pastes/day, free members 20/day, Pro 250/day. Public/unlisted/private modes.                                                                                                                                                                                                                                                       | Fast text/code sharing, API, expiration choices.                                | Multi-file folders, HTML artifact viewing, machine manifest, artifact retention defaults, workspace/audit model.                    | Huge awareness, syntax highlighting, simple web UI, long-lived public sharing.                  |
| Pastes.io                     | Pastebin alternative                 | Free plan lists 1 MB paste limit in search result; Pro is $1/mo billed annually, 25 MB paste limit, no expiration/custom expiration/self-destruct, password protection, API, raw/download access, folders.                                                                                                                                                                                         | Paid paste API with folders and expiration options.                             | Folder-as-artifact with per-file URLs and HTML entrypoint, security posture for generated HTML, agent-specific manifest.            | Very cheap Pro, polished paste feature set, password pastes.                                    |
| PrivateBin                    | Open-source encrypted pastebin       | Self-hosted/open source. Browser-side AES-GCM encryption; URL fragment carries key; password optional. Limits depend on instance config.                                                                                                                                                                                                                                                           | Secure text paste, expiration/password/discussion depending on instance.        | Hosted agent workflow, multi-file HTML artifacts, API keys, Agent View, audit/retention.                                            | Zero-knowledge text storage model and self-host control.                                        |
| Rentry                        | Markdown paste service               | Free. 200,000 characters text limit, custom URLs, edit codes, API/community CLI, entries kept forever unless deleted/rule-breaking.                                                                                                                                                                                                                                                                | Markdown/text publishing with pretty reader page and command-line path.         | Transient TTL by default, HTML/static assets, machine manifest, untrusted-content isolation.                                        | Very low friction, custom URL, durable public pages, markdown ergonomics.                       |
| file.io                       | Temporary file sharing API           | Free account: files up to 2 GB, 4 GB/hour upload limit, deleted after 1 download. Basic: $25/mo, files up to 10 GB, unlimited hourly upload, optional auto-delete, 2 TB storage, 250 GB downloads/mo. Premium: $99/mo, files up to 100 GB, 3 TB storage, 1 TB downloads/mo, custom domain/direct downloads. Public homepage also says no account upload up to 4 GB and default API expiry 14 days. | CLI/API temporary file handoff with expiration.                                 | Multi-file artifact semantics, HTML browser entrypoint, Agent View manifest, workspace keys/audit, content isolation.               | Much larger file limits, simple curl API, binary-file oriented, one-download deletion.          |
| Wormhole / WebWormhole        | Encrypted or P2P file transfer       | Wormhole sends up to 10 GB; files up to 5 GB are stored encrypted for 24 hours, larger files use peer-to-peer transfer. FAQ says a Pro plan is planned for larger file limits. WebWormhole is a direct computer-to-computer transfer surface with browser and command-line entry points.                                                                                                           | Private ephemeral file transfer.                                                | Hosted artifact URLs that can be opened later within TTL, HTML entrypoint, workspace identity/audit, Agent View manifest.           | End-to-end encryption/P2P privacy story and larger-file transfer orientation.                   |
| tmpfiles.org                  | Temporary file host                  | Free; upload max 100 MB; deletion choices shown as 60 minutes, 6 hours, 24 hours, 48 hours.                                                                                                                                                                                                                                                                                                        | Very fast throwaway file upload.                                                | Longer controlled TTL, artifact identity, multiple files, agent-readable manifest, auth/audit.                                      | Zero setup, larger single-file cap than agent-paste MVP, intentionally disposable.              |
| 0x0.st                        | Minimal curl file host               | Free public instance. Official page emphasizes multipart POST, management token/delete ability, and anti-abuse guidance; exact effective limits can be instance-dependent.                                                                                                                                                                                                                         | Terminal-first file sharing.                                                    | Productized workspace/auth/manifest/HTML isolation/retention story.                                                                 | Extremely simple curl UX, culture fit for command-line users.                                   |
| Vercel                        | App hosting / preview deployments    | Hobby free. Pro $20/mo plus usage with $20 included credit. Has deploys, CDN, WAF, CI/CD, spend management. Pricing page includes granular usage items such as Vercel Sandbox and AI Agent.                                                                                                                                                                                                        | Generated web apps and previews.                                                | No repo/build/deploy pipeline required, transient by design, lower conceptual overhead for one-off agent output, Agent View.        | Production-grade hosting, custom domains, full app platform, framework support, team workflows. |
| Netlify                       | App hosting / deploy previews        | Free plan with 300 credit limit/month. Personal $9/mo with 1,000 credits. Pro $20/mo for unlimited members with 3,000 credits/team. Production deploys cost 15 credits; bandwidth 20 credits/GB; web requests 2 credits/10k; unlimited deploy previews/branch deploys included with production deploy semantics.                                                                                   | Static site sharing and preview URLs.                                           | Direct artifact publish without Git/build semantics, TTL cleanup and read ceilings, agent manifest.                                 | Mature deploy previews, collaboration, forms/functions/CDN, production hosting.                 |
| Cloudflare Pages              | Static hosting / preview deployments | Free plan: 500 builds/month, 1 concurrent build, 20-minute build timeout, 20,000 files/site, 25 MiB single asset cap, unlimited active preview deployments, 100 projects soft limit. Paid plans raise build and file counts.                                                                                                                                                                       | Static HTML/site hosting on Cloudflare.                                         | Agent-paste abstracts away Cloudflare account/project/build setup and adds agent-readable manifest plus TTL.                        | Very generous static hosting, custom domains, production-ready CDN, preview deployments.        |
| Replit Deployments            | Online IDE + app publishing          | Starter includes 1 free published app that expires after 30 days and can be republished. Publishing costs use monthly credits; static hosting is free plus data transfer; autoscale charges request/compute usage after credits.                                                                                                                                                                   | Build/share generated apps from an online workspace.                            | Agent-only terminal/API handoff and lower overhead for static artifacts; no dev environment required for viewer/recipient.          | Full editor, runtime, databases, agents, app hosting, persistent project workflow.              |
| CodeSandbox                   | Browser/VM sandbox platform          | Free Build plan: 5 members, 40 monthly VM credit hours, unlimited Browser and VM sandboxes, 10 concurrent VM Sandboxes via SDK. Scale starts at $170/mo/workspace, 160 VM hours, on-demand credits $0.15/hour, 1,000 new sandboxes/hour, 250 concurrent VMs, 10,000 hourly SDK requests.                                                                                                           | Share runnable code environments; SDK can create sandboxes programmatically.    | Cheaper/simpler for static generated artifacts, TTL retention, browser URL + agent manifest, no runtime sandbox costs.              | Real code execution, collaboration, VM/browser sandboxes, private sandboxes.                    |
| StackBlitz                    | Browser IDE / WebContainers          | Free Personal includes unlimited public projects/collections/GitHub repos and up to 1 MB file uploads/project. Pro $18/mo annual or $25 monthly with unlimited file uploads and localhost/API connectivity. Teams $55/member/mo annual or $60 monthly.                                                                                                                                             | Share runnable frontend projects.                                               | Purpose-built non-interactive artifact handoff, TTL/audit/Agent View, no IDE/project account needed for the agent output.           | Excellent instant dev environment, public project sharing, WebContainers.                       |
| Claude Artifacts              | AI-native artifact sharing           | Available on Free/Pro/Max for public publishing; Team/Enterprise share artifacts within org only. Non-users can view/interact with published artifacts. Unpublish revokes access, but the same artifact cannot be republished.                                                                                                                                                                     | Directly validates "AI generated thing with share link."                        | Model/vendor-neutral CLI surface, machine-readable manifest, workspace API keys, TTL and platform-level untrusted-content controls. | Built into the creation flow; viewers can customize/remix inside Claude.                        |
| ChatGPT Shared Links / Canvas | AI-native chat/canvas sharing        | Shared links available across ChatGPT web/mobile; anyone with the link can view. No granular permissions or expiration for shared links. Canvas sharing available across all plans; can share rendered React/HTML code, documents, or code; code canvas can execute Python in browser.                                                                                                             | Sharing AI-created conversation/canvas output.                                  | External CLI/API publishing, explicit TTL, machine manifest, multi-agent handoff, not tied to a ChatGPT conversation.               | Massive distribution, zero extra tool, source conversation context travels with the link.       |
| v0                            | AI app builder + deploy path         | Free: $5 monthly credits, deploy apps to Vercel, Design Mode, GitHub sync, 7 messages/day. Team: $30/user/mo with $30 credits/user and daily login credits. Business: $100/user/mo, training opt-out by default. Token pricing published by model tier.                                                                                                                                            | AI-generated UI/app sharing and Vercel deploy.                                  | Agent-neutral artifact host, retention-by-default, less expensive/smaller scope for "show this output" tasks, Agent View JSON.      | Generates the app, design editor, GitHub/Vercel integration, team chat collaboration.           |

## Cost And Limits Detail

This section is the purchasing-oriented view. "Not published" means I did not find a current numeric price or limit on the official page checked on 2026-05-25.

| Product                       | Free cost / included usage                                                                                                                                                                                                                                                                                                                          | Paid cost                                                                                                                                                                                                      | Paid limits / overage model                                                                                                                                                                                                                                                                                       | Expiration / retention                                                                                                                    | Important caveats                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| agent-paste                   | No billing yet. Current caps are platform caps: `10 MB` file, `25 MB` artifact, `100` files, default TTL `30d`, max TTL `90d`, actor rate target `60 rpm`, workspace burst `300 rpm`.                                                                                                                                                               | No paid plan yet.                                                                                                                                                                                              | Future pricing not defined. Good candidate meters: artifacts/month, artifact GB stored, read bandwidth/read cap, retention window, API keys/workspaces/audit, MCP/API access.                                                                                                                                     | Always expires in current product posture; no forever retention in MVP posture.                                                           | Must stay explicit that it is not production hosting.                                                           |
| GitHub Gist                   | Free with GitHub account; public and secret gists.                                                                                                                                                                                                                                                                                                  | No gist-specific paid tier found; GitHub paid plans are for broader GitHub features.                                                                                                                           | REST API truncates inline file content after `1 MB`; files over `10 MB` require clone for full contents; file list may truncate after `300` files.                                                                                                                                                                | No automatic TTL found for gists.                                                                                                         | Secret gists are unlisted, not private; anyone with URL can view.                                               |
| Pastebin                      | Free account/guest. Free member max paste size `500 KB`, `20` pastes/day, `10` unlisted, `10` private. Guests `10` pastes/day.                                                                                                                                                                                                                      | PRO account page currently says PRO accounts are sold out; no active numeric price visible.                                                                                                                    | PRO: `10 MB` max paste size, `250` pastes/day, unlimited unlisted/private, CORS headers, direct file uploads, scraping API, no ads/captcha.                                                                                                                                                                       | User-selected expiration. PRO has inactivity protection; free/guest may be deleted for inactivity in the future per FAQ.                  | Treat price as unavailable, not free.                                                                           |
| Pastes.io                     | Free: `$0/mo`, `1 MB` paste limit, `1 month` expiration, sponsored ads, title-only search.                                                                                                                                                                                                                                                          | Pro: `$1/mo` billed yearly (`$12/year`; page shows `$2` crossed out / `$1`).                                                                                                                                   | Pro: `25 MB` paste limit, no expiration/custom expiration/self-destruct, no ads, password protection, title+content search, API, raw/download, folders.                                                                                                                                                           | Free expires after 1 month. Pro can choose no expiration/custom/self-destruct.                                                            | Very cheap direct paste competitor for text/code only.                                                          |
| PrivateBin                    | Open source/self-hosted; software cost `$0`. Public instance costs/limits vary by operator.                                                                                                                                                                                                                                                         | No hosted official paid plan found.                                                                                                                                                                            | Instance-configured paste size/retention; no universal limit.                                                                                                                                                                                                                                                     | Instance-configured; supports expiration and optional passwords.                                                                          | Server has zero knowledge of paste content, but users still trust served JS and instance operator availability. |
| Rentry                        | Free. `200,000` characters text limit. Custom URL `2-100` chars; edit code `1-100` chars.                                                                                                                                                                                                                                                           | No paid plan found.                                                                                                                                                                                            | No paid limits found.                                                                                                                                                                                                                                                                                             | Kept forever unless deleted or rule-breaking; URL hoarding can be reclaimed if not genuine/recent.                                        | Good for durable markdown pages, weak for transient agent artifacts.                                            |
| file.io                       | Free account: `$0/mo`, files up to `2 GB`, `4 GB/hour` upload limit, deleted after one download. Homepage also advertises no-account sharing up to `4 GB` and API default expiry `14 days`.                                                                                                                                                         | Basic: `$25/mo`. Premium: `$99/mo`.                                                                                                                                                                            | Basic: files up to `10 GB`, unlimited hourly upload, optional auto-delete, `2 TB` permanent storage, `250 GB` downloads/month. Premium: files up to `100 GB`, `3 TB` permanent storage, `1 TB` downloads/month, custom domain, direct downloads.                                                                  | Free auto-deletes after one download; API supports expiry. Paid can make auto-delete optional.                                            | Strongest cost/limit competitor for raw file transfer; much larger files than agent-paste.                      |
| Wormhole                      | Free. Send up to `10 GB`; files up to `5 GB` stored encrypted on server for `24 hours`; larger files use P2P and require sender page to stay open.                                                                                                                                                                                                  | Pro planned, price not published.                                                                                                                                                                              | Pro planned for larger file limits; no official numeric paid limits found.                                                                                                                                                                                                                                        | Server-stored files deleted after `24 hours`.                                                                                             | Strong privacy/P2P transfer; not a hosted artifact URL/manifest product.                                        |
| WebWormhole                   | Free/open source surface; sends files/text computer-to-computer.                                                                                                                                                                                                                                                                                    | No paid plan found.                                                                                                                                                                                            | No official paid limits found.                                                                                                                                                                                                                                                                                    | Ephemeral live transfer rather than hosted retention.                                                                                     | Requires both sides to participate in transfer; different job than durable artifact handoff.                    |
| tmpfiles.org                  | Free. Max upload `100 MB`; deletion choices `60 minutes`, `6 hours`, `24 hours`, `48 hours`.                                                                                                                                                                                                                                                        | No paid plan found.                                                                                                                                                                                            | No paid limits found.                                                                                                                                                                                                                                                                                             | Very short fixed expiry windows.                                                                                                          | Larger single-file cap than agent-paste MVP, but no workspace/artifact/manifest model.                          |
| 0x0.st                        | Free public instance.                                                                                                                                                                                                                                                                                                                               | No paid plan found.                                                                                                                                                                                            | Effective limits/blocks are operator/abuse driven; official page emphasizes avoiding heavy automated use and running your own instance for testing.                                                                                                                                                               | Not clearly published in the page checked.                                                                                                | Minimal terminal utility, not a commercial SLA product.                                                         |
| Vercel                        | Hobby free. Pricing page lists free forever; limits doc lists `200` projects, `100` deployments/day, `2,000` CLI deployments/week, `45 min` build time, `100 MB` static file uploads, `1` concurrent build. Pricing page includes some included usage, e.g. Functions `4` active CPU hours, `360 GB-hrs` memory, `1M` invocations, `20 GB` network. | Pro: `$20/mo + additional usage` with `$20` included usage credit. Enterprise custom.                                                                                                                          | Examples from pricing page: Functions active CPU from `$0.128/hr`, memory from `$0.0106/GB-hr`, invocations from `$0.60/1M`, network from `$0.15/GB`; build minutes from `$0.014/min` standard, `$0.028/min` enhanced, `$0.105/min` turbo. Pro limits include `6,000` deployments/day and `12` concurrent builds. | Deployments persist until deleted/replaced; no artifact TTL model.                                                                        | Best for real apps. Pricing can expand with compute/network/build usage.                                        |
| Netlify                       | Free: `$0`, `300` credits/month hard limit.                                                                                                                                                                                                                                                                                                         | Personal: `$9/mo`, `1,000` credits/month. Pro: `$20/mo` for unlimited members, `3,000` credits/team/month. Enterprise custom. Add-on credits: Personal `$5/500`; Pro `$10/1,500`.                              | Production deploys `15` credits; compute `10 credits/GB-hour`; bandwidth `20 credits/GB`; web requests `2 credits/10k`. Concurrent builds: Free `1`, Personal `1` then `$40` each, Pro `3` then `$40` each. Preview servers: `1`, then `$15` each.                                                                | Deploys persist; not TTL-first.                                                                                                           | If credits run out, projects can pause unless upgraded/auto-recharged.                                          |
| Cloudflare Pages              | Free Cloudflare account: `$0`. Pages limits: `500` builds/month, `1` concurrent build, `20 min` build timeout, `100` custom domains/project, `20,000` files/site, `25 MiB` single asset, unlimited active preview deployments, `100` projects soft limit.                                                                                           | Cloudflare account plans: Pro `$20/mo` billed annually or `$25/mo` monthly; Business `$200/mo` billed annually or `$250/mo` monthly; Enterprise custom.                                                        | Pages paid limits: Pro `5,000` builds/month and `5` concurrent builds; Business `20,000` builds/month and `20` concurrent builds; paid sites can have up to `100,000` files/site with current Wrangler major config.                                                                                              | Deployments persist; not TTL-first.                                                                                                       | Very strong free static hosting alternative; requires project/build/account model.                              |
| Replit Deployments            | Starter includes `1` free published app; deployment expires after `30 days` but can be republished. Development databases are free per docs.                                                                                                                                                                                                        | Core/Pro pricing should be checked on Replit pricing page; deployment docs describe monthly credits and usage-based publishing after credits.                                                                  | Static deployments: hosting free plus data transfer. Autoscale/request-based examples: personal blog about `$1.05/mo`, small business site about `$3.07/mo`, API service about `$14.27/mo`, background job about `$1.16/mo` in docs examples.                                                                     | Starter free published app expires after `30 days`; paid deployments depend on product configuration.                                     | Pricing is usage/credit based; exact base plan prices are outside the deployment-pricing page.                  |
| CodeSandbox                   | Build plan: `$0`, `5` members, `40` monthly VM credit hours, unlimited Browser/VM Sandboxes, SDK lite, `10` concurrent VM sandboxes, private sandboxes, VM specs up to `4 vCPU + 8 GiB RAM`, storage `20 GB`.                                                                                                                                       | Scale: from `$170/mo/workspace`. Enterprise custom. Current page also references a Pro column in plan details but top pricing card did not show a Pro price in the checked page.                               | Scale: `160` monthly VM credit hours, on-demand VM credits `$0.15/hour`, `1,000` new sandboxes/hour, `250` concurrent VMs, `10,000` SDK requests/hour. Enterprise custom.                                                                                                                                         | Session length listed as unlimited.                                                                                                       | Overkill for static artifact handoff; strong for live code environments.                                        |
| StackBlitz                    | Personal: `$0/mo`; unlimited public projects/collections/GitHub repos; `1 MB` file uploads/project.                                                                                                                                                                                                                                                 | Pro: `$18/mo` billed annually or `$25/mo` monthly. Teams: `$55/member/mo` billed annually or `$60/member/mo` monthly. Enterprise custom.                                                                       | Pro adds unlimited file uploads, localhost/backend/API connectivity, CORS-protected APIs. Teams adds private collections/org private repos/private npm/team billing.                                                                                                                                              | Public projects persist; no TTL-first artifact model.                                                                                     | Great IDE/project share; not transient handoff.                                                                 |
| Claude Artifacts              | Publishing available on Free/Pro/Max; no artifact-specific price published on help page.                                                                                                                                                                                                                                                            | Claude plan pricing not on the artifact help page. Team/Enterprise support org-only sharing.                                                                                                                   | Artifact publish/share limits not numerically published on help page.                                                                                                                                                                                                                                             | Published artifacts can be unpublished; same artifact cannot be republished. Team/Enterprise artifacts are org-only.                      | Built into Claude usage; cost is bundled into Claude subscription/usage, not artifact hosting.                  |
| ChatGPT Shared Links / Canvas | Shared links and Canvas sharing available across plans including Free.                                                                                                                                                                                                                                                                              | ChatGPT plan pricing not on the linked help pages.                                                                                                                                                             | No granular permission or expiration controls for shared links. Canvas can share rendered React/HTML, documents, or code; Python code execution in browser.                                                                                                                                                       | Shared links have no expiration setting; deleting original link/conversation can disable access, but recipients may have imported copies. | Cost is bundled into ChatGPT plan; not a standalone artifact host.                                              |
| v0                            | Free: `$0/mo`, `$5` monthly credits, deploy apps to Vercel, Design Mode, GitHub sync, `7` messages/day.                                                                                                                                                                                                                                             | Team: `$30/user/mo`, `$30` credits/user/month plus `$2` daily login credits. Business: `$100/user/mo`, `$30` credits/user/month plus `$2` daily login credits, training opt-out by default. Enterprise custom. | Token prices: v0 Mini input `$1/1M`, output `$5/1M`; v0 Pro input `$3/1M`, output `$15/1M`; v0 Max input `$5/1M`, output `$25/1M`; v0 Max Fast input `$30/1M`, output `$150/1M`. Cache write/read prices also published.                                                                                          | v0 projects/deploys are not TTL-first.                                                                                                    | Competes where the user wants generation + deployment, not just artifact handoff.                               |

## Feature Comparison Themes

### Text pastebins are too narrow

Pastebin, Pastes.io, Rentry, PrivateBin, and GitHub Gist are strong for text/code snippets. They are weak for the specific agent-paste loop because they usually treat content as one document or flat files, not a generated work product with a browser entrypoint and a machine-readable manifest.

GitHub Gist is the most credible "good enough" substitute for developer users. It has CLI support, API support, history, clone/fork, and multi-file support. Its gaps are directories, controlled TTL, untrusted HTML serving policy, and agent-facing manifest semantics.

### Temporary file hosts have the right ephemerality but not the artifact model

file.io, tmpfiles.org, and 0x0.st prove users accept curl-first temporary sharing. They are usually file-first, not artifact-first:

- No stable artifact/revision domain model.
- No first-class HTML entrypoint.
- No per-file manifest for downstream agents.
- Weak workspace/audit/admin model.
- Most are intentionally anonymous, which is good for zero-friction sharing but bad for team/agent infrastructure.

file.io is the strongest competitor in this group because it combines API, expiration, large file limits, and paid plans. It is still more "send this file" than "publish this generated work product."

### Deploy platforms solve too much

Vercel, Netlify, Cloudflare Pages, Replit, CodeSandbox, and StackBlitz can all share generated web work. They are better when the artifact should become a project, app, branch preview, or production deployment.

They are worse when the desired action is:

```sh
agent-paste publish ./report --ttl 7d
```

without creating a repo, project, build pipeline, environment, deploy target, or ongoing hosting liability.

This is a defensible wedge only if agent-paste keeps the product clearly below "hosting." The docs already support that: artifacts are transient handoffs, read ceilings should stay low, and high-traffic hosting belongs elsewhere.

### AI-native artifact sharing proves demand but is ecosystem-locked

Claude Artifacts, ChatGPT Canvas/shared links, and v0 show that users want to share AI-generated work. They also shape expectations: instant preview, customization/remix, and links that work for non-users.

Their gaps are exactly where agent-paste could matter:

- Outputs are tied to one vendor's chat/workspace.
- Publishing usually starts inside a human UI, not an external agent/CI CLI.
- Links are not designed as cross-agent durable protocol surfaces.
- Permissions/expiration can be coarse or absent, depending on product.
- Machine-readable artifact manifests are not the primary product contract.

## Pricing And Limits Notes

Pricing changes frequently; re-check before using this report for packaging.

- Agent-paste currently has no billing/plans. MVP limits are platform caps, not commercial tiers.
- Pastebin-style competitors often price by paste size, paste count, privacy, ads, and API access.
- File-transfer competitors price by max file size, monthly storage, download bandwidth, and retention/deletion behavior.
- Deploy-platform competitors price by seats, build minutes, requests, bandwidth, compute, and advanced security/support.
- AI-native competitors price primarily by AI usage credits/tokens/messages, not artifact hosting alone.

This matters for positioning. Agent-paste should not price like a deploy platform unless it grows into one. A future package could be framed around:

- artifacts/month,
- artifact size/file caps,
- retention window,
- read bandwidth/read cap,
- workspaces/API keys/audit retention,
- MCP/API integrations,
- compliance/security controls.

## Wedge Candidates

### 1. "One command from any agent"

The most credible wedge is a CLI/API that any coding agent, CI job, or local script can use without requiring the artifact to live inside Claude, ChatGPT, v0, GitHub, or a deploy provider.

Positioning:

> Publish transient agent work products from any tool. Get a browser URL for humans and a manifest URL for agents.

### 2. Machine-readable handoff, not just a link

Most competitors optimize for a human opening a URL. Agent-paste also returns `agent_view_url`, which gives another agent structured metadata and per-file URLs.

This is a real differentiator if it becomes a stable protocol:

- title,
- artifact/revision IDs,
- expiration,
- entrypoint,
- file list,
- content types,
- sizes,
- signed per-file URLs,
- future safety warnings,
- future bundle/revision metadata.

### 3. Secure-by-default generated HTML

Generated HTML is risky: scripts, network egress, phishing, secret exposure, and abuse. Agent-paste's architecture has a strong story:

- isolated content origin,
- private storage,
- no direct object URLs,
- CSP/headers,
- extension-derived MIME,
- short-lived signed content tokens,
- denylist/lockdown path,
- audit events.

Pastebins and temporary file hosts generally do not communicate this as the core product promise. Deploy platforms can be secure, but they are not tuned for untrusted one-off agent output.

### 4. Transient by default

Most tools either keep content forever, keep it until manual deletion, or delete it very quickly. Agent-paste's `1d` to `90d` TTL is a middle lane for review artifacts, generated reports, demos, and logs.

This should remain a product principle: agent-paste is not permanent hosting.

### 5. Dashboard/admin for teams without becoming Vercel

The Phase 3 dashboard/API-key/audit work can become a team wedge if it stays operational:

- who published what,
- which API key did it,
- when does it expire,
- revoke/delete/lockdown,
- inspect usage and audit events.

This is valuable for organizations adopting agents, but it should not drift into full app hosting workflows.

## Risks

- **Good-enough substitutes are abundant.** Developers can use Gist, file.io, `wrangler pages deploy`, Vercel, Netlify, or the AI tool's native sharing.
- **Distribution is harder than implementation.** Agent-paste needs to be present where agents run: CLI install, docs, MCP later, GitHub Actions snippets, maybe SDKs.
- **HTML hosting creates abuse pressure.** The security posture is not optional; takedowns, phishing, malware, bandwidth abuse, and secret leakage are category risks.
- **The product can overbuild itself.** If it becomes a generic hosting platform, it competes directly with Vercel/Netlify/Cloudflare Pages and loses the simplicity wedge.
- **Limits must be explicit.** Agent users will automate. Published caps, rate limits, retention, and failure envelopes need to be boring and predictable.

## Recommendations

1. Keep the headline away from "pastebin." Use "artifact handoff for agents" or "transient artifact publishing for agents and CI."
2. Make the CLI loop the marketing demo: `agent-paste publish ./site --ttl 7d` returns human URL + agent manifest URL.
3. Treat `agent_view_url` as the protocol differentiator. Document it prominently and keep it stable.
4. Add first-party snippets for Claude Code/Codex/Cursor/GitHub Actions once public distribution matters.
5. Keep limits intentionally modest. Let Vercel/Netlify/Cloudflare Pages own high-traffic hosting.
6. Future paid tiers should price around artifact volume, retention, size, read bandwidth, team/audit controls, and MCP/API access rather than seats alone.
7. Consider a "public artifact manifest" spec page early. It gives other agents a reason to integrate even before MCP is built.

## Source Links

Official sources checked on 2026-05-25:

- GitHub Gist docs: <https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists>
- GitHub Gist REST API docs: <https://docs.github.com/en/rest/gists/gists>
- Pastebin FAQ: <https://pastebin.com/page/faq>
- Pastebin PRO page: <https://pastebin.com/pro>
- Pastes.io pricing: <https://pastes.io/pricing>
- PrivateBin project page: <https://privatebin.info/>
- Rentry docs: <https://rentry.co/what>
- file.io homepage: <https://www.file.io/>
- file.io plans: <https://www.file.io/plans>
- Wormhole homepage: <https://wormhole.app/>
- Wormhole FAQ: <https://wormhole.app/faq>
- WebWormhole: <https://webwormhole.com/>
- tmpfiles.org: <https://tmpfiles.org/>
- 0x0.st: <https://0x0.st/>
- Vercel pricing: <https://vercel.com/pricing>
- Vercel limits: <https://vercel.com/docs/limits>
- Netlify pricing: <https://www.netlify.com/pricing/>
- Cloudflare Pages limits: <https://developers.cloudflare.com/pages/platform/limits/>
- Cloudflare plans: <https://www.cloudflare.com/plans/>
- Replit deployment pricing docs: <https://docs.replit.com/billing/deployment-pricing>
- CodeSandbox pricing: <https://codesandbox.io/pricing>
- StackBlitz pricing: <https://stackblitz.com/pricing>
- Claude artifact publishing/sharing help: <https://support.claude.com/en/articles/9547008-publishing-and-sharing-artifacts>
- ChatGPT shared links FAQ: <https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq>
- ChatGPT Canvas help: <https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it>
- v0 pricing: <https://v0.app/pricing>
