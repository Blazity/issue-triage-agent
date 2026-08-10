# ADR 0001: Human-gated publication

## Status

Accepted

## Context

Issue investigation combines untrusted support text, untrusted repository content, probabilistic model output, and credentials capable of writing to GitHub. A plausible repair can still be incomplete, unsafe, or inconsistent with product intent. Passing a local check proves only the behavior encoded by that check. It does not authorize a release.

The workflow should remove repetitive investigation work without silently expanding into deployment automation. Reviewers need a concrete candidate and evidence, while repository owners must retain control over merge, release, and rollback decisions.

## Decision

The agent may prepare a pull request only after deterministic reproduction, verification, path, deadline, budget, and disclosure gates pass. The configured reproduction check must fail before the repair and pass afterward. The exact verified candidate is bound to its base commit and digest before publication.

Pull requests are drafts by default. Public-repository publication and source-ticket disclosure require explicit opt-in. The agent never approves, merges, releases, deploys, modifies branch protection, or writes repository secrets.

Stopped investigations produce a human handoff with the verdict, evidence, executed checks, and recommended next action. A stopped result is a valid outcome, not an invitation to bypass policy.

## Consequences

- Reviewers receive evidence and a concrete diff without surrendering release authority.
- Repository branch protection and ordinary review policy remain effective.
- Some valid fixes stop for human handling when a deterministic gate cannot prove eligibility.
- Operators must define meaningful checks. Weak tests cannot be compensated for by model confidence.

## Rejected alternatives

- **Automatic merge after tests pass:** rejected because tests are incomplete evidence and model output is not authorization.
- **Model-decided exceptions:** rejected because safety policy must remain deterministic and auditable.
- **Comment-only suggestions:** rejected because a verified draft PR removes more toil while preserving human control.
