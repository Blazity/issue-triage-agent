# ADR 0004: AI provider data boundary

## Status

Accepted

## Context

Investigation needs issue context, repository evidence, and configured check results. Sending all available data to a model would expose customer text, secrets, irrelevant metadata, and protected source files to an external processor. Provider retention and training behavior are also separate from application-level access control.

Redaction cannot prove that arbitrary text is free of sensitive information. Request flags cannot replace contractual and operational review. The system therefore needs several independent controls and an explicit operator decision before live model traffic is enabled.

## Decision

Model inputs are minimized before every request:

- issue title and description are redacted;
- inbound metadata is denied unless its key is explicitly allowlisted;
- repository file listings and reads use the same allowed and blocked path policy as repair authorization;
- requested file contents and check evidence are redacted and bounded; and
- raw credentials and GitHub tokens never enter the model or Sandbox context.

Every AI Gateway request sets `zeroDataRetention=true` and `disallowPromptTraining=true`. Readiness requires `AI_DATA_POLICY_ACKNOWLEDGED=true`, an explicit model ID, and the Gateway credential. Documentation states that the acknowledgement confirms an operator review; it does not alter provider behavior by itself.

## Consequences

- Model context is smaller and less likely to contain unrelated sensitive data.
- Protected paths are neither listed nor readable through model tools.
- Some investigations need human handling because required evidence is outside the approved disclosure policy.
- Operators remain responsible for provider terms, residency, access controls, logs, and staging proof.

## Rejected alternatives

- **Send the full repository and ticket:** rejected because it violates least disclosure.
- **Rely only on redaction:** rejected because heuristic redaction is not a confidentiality guarantee.
- **Rely only on provider flags:** rejected because routing controls do not replace path authorization, consent, or provider review.
