# ADR 0005: Explicit routes and GitHub identities

## Status

Accepted

## Context

Issue text is not a reliable source of repository ownership. Guessing from titles, tags, or model output can route customer data to the wrong codebase and can grant publication authority outside the intended scope. Repository names can also be transferred or recreated, while a GitHub App installation may cover only a subset of an organization.

The configuration must be understandable to operators while binding runtime authority to stable GitHub objects.

## Decision

Source adapters normalize routing keys, but routes are declared in `triage.config.ts`. Each route maps a source and routing key to one or more configured repository keys. Unmapped signals stop with an explicit human handoff.

Each repository configuration contains:

- a local stable key used by routes;
- a human-readable owner used in assessments;
- GitHub owner and repository coordinates;
- the immutable numeric GitHub repository ID;
- the numeric GitHub App installation ID; and
- an explicit base branch, bootstrap commands, checks, and policy.

The runtime verifies repository identity before using a short-lived installation token. Placeholder names are rejected when triage is enabled. Installing the GitHub App on the target repository is the connection; no agent code or webhook is added to that repository.

## Consequences

- Repository access is explicit, reviewable, and resistant to name ambiguity.
- Multi-repository routes are deliberate rather than inferred.
- Operators must update configuration when service ownership or App installations change.
- The same reusable workflow can support different organizations without hard-coded repositories.

## Rejected alternatives

- **Model-selected repository:** rejected because model judgment cannot grant repository access.
- **Organization-wide App installation:** rejected as a default because it exceeds least privilege.
- **Name-only identity:** rejected because names are mutable and do not prove the intended App installation.
