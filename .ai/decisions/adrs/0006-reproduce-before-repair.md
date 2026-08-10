# ADR 0006: Reproduce before repair

## Status

Accepted

## Context

Support reports are incomplete evidence. A model can propose a plausible code change without proving that the repository contains the reported defect or that the change addresses it. Allowing publication from a passing test alone is especially weak because the test may have passed before any modification.

The workflow needs a repository-specific, repeatable criterion that distinguishes diagnosis from speculation and binds verification to the exact candidate sent to GitHub.

## Decision

Every configured repository defines at least one deterministic check. Before repair, a named check must reproduce the issue by failing. After a candidate is written, configured checks run again and must pass. A check that mutates the workspace is recorded and then rejected.

The final candidate digest includes the base commit, normalized path, Git file mode, and content for every changed file. The digest is measured around final verification. GitHub publication preserves the verified file mode and rechecks the repository base immediately before writing.

The model may explain evidence and propose edits, but deterministic code decides whether reproduction, checks, paths, deadline, patch attempts, and publication budget allow a pull request. Inconclusive, non-reproduced, or failed-check outcomes become human handoffs.

## Consequences

- A draft pull request carries stronger evidence than a plausible diff alone.
- Repository teams must maintain checks that isolate important failure modes.
- Issues without a deterministic reproduction path stop for human investigation.
- Candidate identity can be reconciled safely across retries and external API failures.

## Rejected alternatives

- **Publish when all tests pass after editing:** rejected because the same tests may have passed before the change.
- **Use model confidence as proof:** rejected because confidence is not deterministic evidence.
- **Allow checks to update snapshots automatically:** rejected because verification would silently change the candidate being approved.
