# Security Policy

## Supported versions

agent-paste is pre-1.0 and ships from `main`. Only the latest released version
of the CLI (`@zaks-io/agent-paste`) and the current state of `main` receive
security fixes. There are no long-term support branches.

| Version                               | Supported          |
| ------------------------------------- | ------------------ |
| latest (`main` / current CLI release) | :white_check_mark: |
| anything older                        | :x:                |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately through GitHub's [private vulnerability reporting](https://github.com/zaks-io/agent-paste/security/advisories/new).
If you cannot use GitHub advisories, email **isaac@zaks.io** with
"SECURITY" in the subject line.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- Affected component (CLI, MCP server, a Worker, the hosted service, etc.) and
  version or commit.

### What to expect

- Acknowledgement within 5 business days.
- A best-effort assessment and, where applicable, a coordinated fix and
  disclosure timeline.
- Credit in the advisory if you would like it.

This is a solo, best-effort project. There are **no service-level guarantees and
no support contract** unless separately agreed in writing.

## Bug bounty

There is **no bug bounty program** and no monetary reward for reports. Disclosure
is appreciated and credited.

## Scope

This policy covers the source in this repository and the CLI package. The hosted
service operated by zaks-io is also in scope for vulnerability reports; please
report responsibly and do not access, modify, or exfiltrate data that is not
your own while testing.
