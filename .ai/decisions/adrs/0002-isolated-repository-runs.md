# ADR 0002: Isolated repository runs

## Status

Accepted

## Context

One issue signal may map to several repositories. Those repositories can use different runtimes, checks, ownership rules, and publication policies. Their source trees and package scripts are untrusted. A failure or malicious instruction in one repository must not control another repository or gain access to GitHub credentials.

The workflow also needs partial success. A backend investigation should still produce a useful outcome when a frontend repository cannot bootstrap, and the final notification should describe both results.

## Decision

Each routed repository is investigated independently in a separate ephemeral Vercel Sandbox. The Sandbox receives one immutable source snapshot, a time-bounded task, narrow bootstrap egress, and no GitHub credentials. Network access is denied after bootstrap. The model can read only policy-allowed paths and can run only operator-configured checks.

Repository ownership, deadlines, and publication identity are fenced in durable state. Outcomes are collected with failure isolation so one rejected repository task does not discard completed outcomes from other repositories. GitHub publication happens in the trusted control plane after the Sandbox is closed.

## Consequences

- Repository failures remain local to their own outcome.
- No repository code can directly use the GitHub App credential.
- Multi-repository incidents can yield independent pull requests and handoffs.
- Each repository requires explicit bootstrap commands, checks, routes, and path policy.
- Isolation adds execution cost and makes cross-repository changes independent rather than atomic.

## Rejected alternatives

- **One shared workspace for all repositories:** rejected because it couples failures and expands the disclosure and credential boundary.
- **GitHub token inside the Sandbox:** rejected because untrusted code and package scripts could exfiltrate it.
- **Stop the whole incident on first error:** rejected because it throws away useful work and obscures partial failure.
