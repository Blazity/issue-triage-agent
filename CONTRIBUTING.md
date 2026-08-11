# Contributing

Thanks for improving Issue Triage Agent.

## Before opening a pull request

1. Open or reference an issue for behavior or architecture changes.
2. Keep changes narrowly scoped.
3. Add a failing test before fixing behavior.
4. Preserve the credentialed control-plane and credential-free sandbox boundary.
5. Do not add automatic merge or deployment authority.

Run:

```bash
bun install
bun run format
bun run lint
bun run typecheck
bun test
bun run build
```

Pull requests should explain the problem, security impact, implementation, tests, and any configuration or migration changes. Never include real customer data, repository archives, credentials, or webhook payloads containing personal information.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
