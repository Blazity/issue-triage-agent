# Threat model

The agent processes untrusted issue text and repository content while holding authority to open pull requests. Treat prompt injection, malicious repository files, replayed webhooks, resource exhaustion, and excessive GitHub permissions as expected threats.

## Trust boundaries

- Inbound events are untrusted until signature, freshness, schema, loop, rate, and deduplication checks pass.
- Repository content and package scripts are untrusted.
- Model output is a proposal, never an authorization decision.
- The trusted control plane owns credentials, routing, budgets, policy, and GitHub writes.
- Vercel Sandbox is an isolated execution boundary without GitHub credentials.
- AI Gateway and the selected model provider are external data processors. Redacted issue text, explicitly allowlisted and redacted metadata, redacted contents of policy-allowed model-requested repository files, and redacted check evidence can cross this boundary.
- Vercel Workflow persists the verified repair candidate between investigation and publication steps. Treat Workflow state and observability as source-code-bearing systems.
- Slack and the target GitHub repository are disclosure boundaries. Public-repository PRs and source-ticket context are disabled by default.

## Implemented controls

- HMAC signature verification with a five-minute replay window.
- Maximum 256 KiB inbound request body.
- Exact-event idempotency, hourly normalized-title incident fingerprints, and expiring workflow-start claims.
- Per-source rate limits, global concurrency, workflow-owned fenced repository leases, run deadlines, model-step, and PR budgets.
- Explicit repository allowlist and route map.
- Short-lived GitHub App tokens restricted to one numeric repository ID.
- Bounded repository archive size.
- Bootstrap egress allowlist followed by deny-all networking.
- No arbitrary model shell tool; only operator-configured checks.
- Path, symlink, binary, file-size, patch-attempt, deadline, and test gates.
- A named configured check must fail before a repair and pass afterward before PR eligibility.
- GitHub and Slack requests have per-request timeouts; Sandbox lifetime is bounded.
- Base-SHA recheck immediately before GitHub write.
- Candidate digests are measured before and after final checks; any check-created mutation is rejected.
- Deterministic branch names reconcile only when the branch points to the exact expected commit.
- Raw command output is never used as a Slack incident summary; public failures use bounded operator-safe messages.
- Model-bound text passes through secret and email redaction. Inbound metadata is denied unless its key is explicitly allowlisted. Model file listing and reads use the same repository path policy.
- Every model request sets AI Gateway's `zeroDataRetention` and `disallowPromptTraining` routing controls.
- Public-repository PRs require explicit opt-in. Source issue title, URL, and model summary are omitted from GitHub commit and PR copy by default.
- Expired signals are deleted by an authenticated daily retention job.
- No merge, deploy, secret, environment, or workflow authority.

## Operator responsibilities

- Keep GitHub App installation and permissions minimal.
- Review bootstrap commands; package installation may execute untrusted tooling despite `--ignore-scripts` reducing risk.
- Keep egress allowlists narrow.
- Use dedicated test repositories before production rollout.
- Rotate webhook, Slack, AI Gateway, database, and GitHub App secrets.
- Review and approve the AI provider's retention, training, residency, and access terms before setting `AI_DATA_POLICY_ACKNOWLEDGED=true`; request-level routing controls do not replace that review.
- Restrict access to Vercel logs and Workflow observability because issue summaries may contain customer information.
- Configure data retention appropriate for your organization.
- Require human review and branch protection before merge.

## Explicit non-guarantees

This template reduces risk; it does not prove a generated patch is correct or secure. Passing repository checks is necessary but not sufficient. Human review remains mandatory.

Workflow creation is at-least-once across the Vercel/Neon partial-failure boundary. A stale start claim may be reclaimed. Only one workflow run can own a physical repository at a time: ownership, fencing tokens, exact candidate reconciliation, and idempotent PR budgets prevent a stale or duplicate workflow from publishing unrelated work.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).
