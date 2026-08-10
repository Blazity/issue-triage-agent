# Issue Triage Vocabulary

## Terms

| Term             | Meaning                                                                                | Avoid            |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------- |
| Issue signal     | Authenticated, normalized report entering admission                                    | Raw ticket       |
| Incident         | One admitted signal and its durable multi-repository workflow                          | Agent session    |
| Repository route | Explicit source and routing-key mapping to configured repositories                     | Repository guess |
| Admission        | Signature, freshness, loop, rate, duplicate, and capacity checks before workflow start | Validation only  |
| Investigation    | Bounded reproduction and assessment in an isolated Sandbox                             | Autonomous fix   |
| Repair candidate | Proposed diff that still requires deterministic verification                           | Fix              |
| Policy gate      | Code-owned authorization check for paths, reproduction, tests, budgets, and disclosure | AI approval      |
| Human handoff    | Explicit stopped outcome with evidence and recommended next action                     | Failure          |
| Atlas Core       | Repo-owned AI context and deterministic workspace checks                               | Agent runtime    |
