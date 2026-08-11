# Setup

## 1. Create a Neon database

Set `DATABASE_URL` to a pooled Neon connection string. Set `DATABASE_URL_UNPOOLED` to the direct connection used for migrations, then run:

```bash
bun run db:migrate
```

Migrations are append-only, checksummed, and idempotent. Use a separate database for development and production. Set `CRON_SECRET`; Vercel calls the authenticated daily retention route to remove expired seven-day signal records.

## 2. Create a GitHub App

Install the app only on repositories the agent may investigate. Grant:

- Contents: read and write
- Pull requests: read and write
- Metadata: read (implicit)

Do not grant Administration, Actions, Workflows, Deployments, Environments, or Secrets permissions. The app does not need a GitHub webhook for the current workflow.

Set:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM; escaped newlines are supported)

The GitHub App installation is the connection to each target repository. No agent dependency, webhook, or configuration file needs to be added to those repositories.

For every configured repository:

- `owner` and `repository` are its readable GitHub coordinates;
- `repositoryId` is its immutable numeric GitHub ID; and
- `installationId` identifies the GitHub App installation allowed to access it.

Get the repository ID with:

```bash
gh api repos/OWNER/REPOSITORY --jq .id
```

The installation ID appears in the installation settings URL, such as `https://github.com/settings/installations/12345678`, or can be read through the GitHub App installations API. Copy both numeric IDs into `triage.config.ts`. The runtime verifies them before issuing a repository-scoped installation token.

## 3. Configure AI Gateway

Set `AI_GATEWAY_API_KEY` and an explicit `TRIAGE_MODEL`. The selected model must support tool use and structured output.

The model receives redacted issue title and description, only metadata keys explicitly allowlisted by repository policy, redacted contents of policy-allowed requested repository files, and redacted check evidence. Every request sets AI Gateway's `zeroDataRetention=true` and `disallowPromptTraining=true` routing controls. Review the AI Gateway and provider data-processing terms, then set `AI_DATA_POLICY_ACKNOWLEDGED=true`. This acknowledgement remains required for readiness.

Redaction is heuristic defense in depth. Do not route secrets or regulated data to this system solely because redaction exists. Confirm in staging that the selected model has a provider route compatible with both Gateway controls.

## 4. Configure routing and repository policy

Copy `triage.config.example.ts` to `triage.config.ts`, replace every example value, set `configured: true`, then:

- use a unique repository `key`;
- set a human-readable `owner` for the final assessment;
- define the trusted GitHub repository identity;
- use bootstrap commands appropriate for that repository;
- configure one or more deterministic checks;
- keep egress narrow and only for bootstrap dependencies;
- constrain allowed and blocked repair paths; and
- allowlist only non-sensitive inbound metadata keys in `modelMetadataKeys`; and
- keep public-repository PRs and source-ticket disclosure disabled unless explicitly approved; and
- map source routing keys to repository keys.

Increment `version` whenever a policy or route changes. In-flight runs using another version stop safely.

## 5. Configure inbound webhooks

### Generic signed webhook

Set `WEBHOOK_SECRET` to at least 32 random bytes. Send requests to:

```text
POST https://your-project.vercel.app/api/webhooks/issue
```

Required headers:

```text
content-type: application/json
x-triage-timestamp: <ISO 8601 timestamp>
x-triage-signature: <base64 HMAC-SHA256>
```

Compute the signature over `<timestamp>.<raw JSON body>`.

The body requires `eventId`, `account`, `title`, `description`, `route`, and `occurredAt`. `route` may be one string or an array. The body may also include `url`, `metadata`, and `origin`. Set `origin.generatedBy` to `issue-triage-agent` for events produced by this agent; those events are rejected to prevent loops.

### Zendesk

Set `ZENDESK_WEBHOOK_SECRET` to the signing secret shown by Zendesk and point a Zendesk webhook at:

```text
POST https://your-project.vercel.app/api/webhooks/zendesk
```

Send a JSON object with:

```json
{
  "account": "your-zendesk-subdomain",
  "id": "{{ticket.id}}",
  "title": "{{ticket.title}}",
  "description": "{{ticket.description}}",
  "priority": "{{ticket.priority}}",
  "tags": ["triage_checkout"],
  "url": "https://your-subdomain.zendesk.com/agent/tickets/{{ticket.id}}",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

The route keys are the ticket tags. Configure the trigger narrowly so routine support requests do not start repository investigations. The endpoint verifies Zendesk's timestamp and Base64 HMAC signature before parsing.

## 6. Optional Slack notification

Set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`. Add the bot to the target channel and grant only `chat:write`. The workflow posts one initial message with the source issue and workflow links, then updates the same message with repository outcomes and PR links.

## 7. Deploy

Deploy with the Vercel button in the README or connect the repository to a Vercel project. Add all required environment variables to Production. Apply the database migration before accepting webhooks.

Readiness returns `200` only after required configuration is present, Neon is reachable, and the required migration ledger entry exists:

```text
GET https://your-project.vercel.app/api/health
```

Process liveness is separate:

```text
GET https://your-project.vercel.app/api/health/live
```

Then send one low-risk test signal to a dedicated test repository. Confirm admission, workflow execution, sandbox checks, and a draft PR before enabling production sources.

## Environment variables

| Variable                      | Required       | Purpose                               |
| ----------------------------- | -------------- | ------------------------------------- |
| `DATABASE_URL`                | Yes            | Pooled Neon runtime connection        |
| `DATABASE_URL_UNPOOLED`       | Migration      | Direct Neon migration connection      |
| `GITHUB_APP_ID`               | Yes            | GitHub App identifier                 |
| `GITHUB_APP_PRIVATE_KEY`      | Yes            | GitHub App PEM private key            |
| `AI_GATEWAY_API_KEY`          | Yes            | AI Gateway authentication             |
| `TRIAGE_MODEL`                | Yes            | Explicit Gateway model ID             |
| `AI_DATA_POLICY_ACKNOWLEDGED` | Yes            | Operator approval of AI data boundary |
| `CRON_SECRET`                 | Yes            | Authenticates retention cleanup       |
| `TRIAGE_ENABLED`              | Yes            | Must equal `true` after setup         |
| `WEBHOOK_SECRET`              | Generic source | HMAC webhook secret                   |
| `ZENDESK_WEBHOOK_SECRET`      | Zendesk        | Zendesk signing secret                |
| `SLACK_BOT_TOKEN`             | No             | Slack notification token              |
| `SLACK_CHANNEL_ID`            | No             | Slack notification channel            |
| `WORKFLOW_RUN_URL_TEMPLATE`   | No             | Vercel Workflow run link template     |
