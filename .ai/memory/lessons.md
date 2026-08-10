# Engineering lessons

- Model judgment cannot authorize repository writes; deterministic code must own routing, budgets, disclosure, and publication gates.
- At-least-once workflow recovery needs incident-level ownership before repository fan-out, plus per-repository fencing and exact publication reconciliation.
- Model-step limits must be allocated across the whole incident; independent per-repository minimums can exceed the advertised ceiling.
- Verification must bind the exact candidate published to GitHub, including file mode, base SHA, and post-check digest.
- Policy-allowed paths still need a separate model-disclosure gate and redaction before file content crosses the AI provider boundary.
