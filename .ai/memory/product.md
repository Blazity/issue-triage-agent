# Product

Issue Triage Agent prepares engineering context before a human begins incident work. It accepts authenticated issue signals, reduces duplicate work, routes incidents to explicitly configured repositories, reproduces reported behavior in isolated sandboxes, and can prepare one reviewable pull request per eligible repository.

## Users

- platform and engineering teams handling production incidents;
- support teams escalating reproducible product problems; and
- technical owners who need consistent evidence, ownership, and next actions.

## Current scope

- generic signed webhooks and Zendesk intake;
- explicit multi-repository GitHub routing;
- Neon-backed durable admission, leases, budgets, and outcomes;
- Vercel Workflow orchestration and Vercel Sandbox execution;
- AI SDK investigation through Vercel AI Gateway;
- policy-gated GitHub pull requests; and
- optional Slack lifecycle notifications.

## Non-goals

The template does not merge, release, deploy, choose repositories dynamically, grant arbitrary shell access, or replace organization-specific ownership, severity, access, and escalation policy.
