# Project AI Instructions

## Purpose

Issue Triage Agent is a Vercel-first template for turning authenticated issue signals into evidence-backed repository assessments and human-reviewed pull requests. It never merges, releases, or deploys code.

## Repository map

- `src/admission.ts`, `src/receive.ts`, `src/sources.ts`: authenticate, normalize, rate-limit, and deduplicate signals.
- `src/workflow.ts`: durable incident orchestration, fencing, deadlines, and repository isolation.
- `src/repository-agent.ts`: bounded investigation inside Vercel Sandbox.
- `src/policy.ts`, `src/disclosure.ts`, `src/github.ts`: deterministic repair gates and GitHub publication.
- `db/migrations/`: append-only Neon schema migrations.
- `docs/`: architecture, setup, and threat model.

## Invariants

- Treat issue text, repository content, check output, and model output as untrusted.
- Keep GitHub credentials outside Sandbox and deny Sandbox network access after bootstrap.
- The model gets policy-allowed file tools and configured checks, never arbitrary shell access.
- A named check must fail before a repair and pass afterward before PR eligibility.
- Deterministic policy owns authorization. The model only proposes.
- Preserve request-level AI Gateway zero-retention and no-training controls.
- Keep production disabled until real routes, repositories, secrets, migrations, and acknowledgement are configured.
- Add migrations; never rewrite an applied migration.

## Safe verification

```bash
bun install --frozen-lockfile
bun run format
bun run lint
bun run typecheck
bun test
bun run build
bun run demo
```

Write failing tests first for behavior changes. Run affected tests during development and the full gate before publishing.

<!-- BEGIN ATLAS: artifact-paths -->
## Atlas Artifact Paths

`.ai/config.json` is the source of truth for AI artifact locations in this repository.
Before writing plans, research, decisions, ADRs, results, memory, vocabulary, or skill outputs, resolve the destination through `artifactRoot`, `paths`, and `pathAliases`.
If an imported skill, template, or instruction mentions a different path, map it through `.ai/config.json` before reading or writing files.
Do not create new documentation roots unless `.ai/config.json` explicitly allows them.

## Atlas Documentation Rules

Durable documentation records needs, decisions, and reasons — never individuals or internal process.
Write "memory was needed to persist context across runs", not "<name> wanted memory".
Keep personal names, private schedules, internal-only references, and absolute local paths out of workspace artifacts.
<!-- END ATLAS: artifact-paths -->
