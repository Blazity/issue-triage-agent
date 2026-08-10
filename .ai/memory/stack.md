# Stack and operations

## Runtime

- Next.js 16 and React 19 on Vercel
- Vercel Workflow for durable orchestration
- Vercel Sandbox with Node.js 24 for isolated repository execution
- AI SDK 7 through Vercel AI Gateway
- Neon Postgres for admission, leases, budgets, and outcomes
- GitHub App authentication and Git Data API publication
- Chat SDK Slack adapter for optional notifications
- Bun for dependencies, tests, and scripts

## External systems

- Generic HMAC webhook or Zendesk webhook as source
- GitHub as repository and pull-request host
- Optional Slack notification channel

## Verification

`bun run format`, `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build` form the release gate. `bun run demo` is credential-free and does not prove live vendor integration.

## Deployment

Production enablement is fail-closed. It requires real repository configuration, required environment variables, explicit AI data-policy acknowledgement, and applied database migrations.
