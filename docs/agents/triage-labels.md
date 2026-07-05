# Agent Labels

The skills speak in terms of readiness roles. This file maps those roles to the
actual label strings used in this repo's Linear AP team.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Execution Labels

| Label           | Meaning                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `remote-cursor` | Approved for Cursor Background Agent. It is not readiness or startability without `ready-for-agent` + checks. |

## Repo Route Labels

| Label                 | Meaning                                               |
| --------------------- | ----------------------------------------------------- |
| `zaks-io/agent-paste` | Required repo-route label for issue-assigned AP work. |
| `zaks-io/skills`      | Route label for upstream synced skill work.           |

## Kind Labels

Kind is single-select. Only `kind-slice` is dispatchable.

| Label        | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `kind-spec`  | Spec or PRD container. Do not dispatch.          |
| `kind-epic`  | Workstream or parent container. Do not dispatch. |
| `kind-slice` | One-PR implementation ticket.                    |

## Risk Labels

| Label                     | Meaning                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `risk-normal`             | Normal implementation risk.                                                       |
| `risk-security-sensitive` | Auth, authorization, custody, secrets, audit, or related security-sensitive work. |
| `risk-schema`             | Schema, migrations, RLS, or durable data-contract work.                           |
| `risk-cross-cutting`      | Changes crossing multiple packages, apps, workflows, or contracts.                |

## Type Labels

Use Linear's `Type` label group when it is available: `Bug`, `Feature`,
`Improvement`, `Tech Debt`, `Spike`, and `Hotfix`.

The labels need to exist on the Linear AP team. Create any missing ones with
the available Linear label creation tool on first use; cache the resolved ids
per session.

## Review Evidence Labels

| Label                | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `code-review-passed` | Current linked PR head passed the configured local review gate. |

Edit the right-hand column to match whatever vocabulary you actually use.
