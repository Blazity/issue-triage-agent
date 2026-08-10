# ADR 0003: Durable ownership and fencing

## Status

Accepted

## Context

Webhook delivery, Workflow execution, database writes, and GitHub requests are at-least-once operations. Processes can stop between reserving work and recording its external result. A retry can therefore overlap an earlier run that is delayed rather than dead. Without ownership rules, duplicate runs could consume budgets twice, publish conflicting branches, or overwrite a newer outcome.

In-memory locks do not survive process termination and cannot coordinate serverless instances. Repository-level locks alone are insufficient because two duplicate workflows could each claim a different repository and split one incident between owners.

## Decision

Admission records exact-delivery idempotency and a normalized incident fingerprint in Neon. Workflow start claims expire so a process crash before a run ID is recorded can be recovered.

Each incident acquires one durable ownership lease before repository fan-out. Repository work then acquires a physical repository lease with its own fencing token and deadline. State transitions and final aggregate writes require the current fencing token. A stale run may finish local computation, but it cannot publish or replace the canonical result.

A duplicate workflow that encounters an active incident owner durably waits for the lease expiry and may perform one bounded takeover. Takeover receives a fresh execution deadline. It does not create an unbounded retry loop.

Publication uses deterministic branch identity, exact base and head reconciliation, and an idempotent daily pull-request budget. Recovery accepts an existing pull request only when its target, candidate commit, and draft policy match the expected publication.

## Consequences

- Crashes and duplicate deliveries can recover without allowing stale publication.
- Incident ownership prevents different workflows from splitting repository ownership.
- Durable coordination depends on correctly applied, append-only database migrations.
- Operators must monitor expired claims and handoffs because recovery is bounded, not infinite.

## Rejected alternatives

- **In-memory mutexes:** rejected because they do not coordinate serverless instances or survive crashes.
- **Repository locks without incident ownership:** rejected because duplicate workflows can split ownership across repositories.
- **Unlimited automatic retry:** rejected because it can multiply model cost and create permanent loops.
