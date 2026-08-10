# Architecture

## Flow

1. A source adapter authenticates and normalizes an issue signal.
2. Admission enforces freshness, recursion, rate, duplicate, and concurrency policy in Neon.
3. Vercel Workflow acquires incident ownership before repository fan-out.
4. Each configured repository receives an independent fenced run and immutable GitHub snapshot.
5. Vercel Sandbox bootstraps with narrow egress, then switches to deny-all networking.
6. The AI SDK agent reads only policy-allowed, redacted files and runs only configured checks.
7. Deterministic policy evaluates reproduction, candidate digest, paths, tests, deadlines, budget, and disclosure.
8. Eligible repositories receive independent GitHub pull requests; all others receive a human handoff.

## Trust boundaries

- The control plane owns credentials, routing, durable state, budgets, and GitHub writes.
- Sandbox receives source code and a bounded task, but no GitHub credentials.
- AI Gateway and the selected provider receive only redacted, policy-allowed model context with request-level zero-retention and no-training routing controls.
- Slack and GitHub are disclosure boundaries; source-ticket context and public-repository publishing are disabled by default.

## Recovery invariants

- Workflow creation and external APIs are treated as at-least-once.
- Incident and repository ownership use deadlines plus fencing tokens.
- Candidate digests include file path, content, and Git mode.
- Publication reconciles exact base, head, draft policy, and candidate identity.
