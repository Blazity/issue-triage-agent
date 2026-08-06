import type { CheckResult } from "./domain";

export class OperationalError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "OperationalError";
  }
}

export class RepositoryInvestigationError extends OperationalError {
  readonly checks: Pick<CheckResult, "command" | "exitCode">[];

  constructor(error: unknown, checks: CheckResult[]) {
    super("repository_investigation_failed", publicErrorSummary(error));
    this.name = "RepositoryInvestigationError";
    this.checks = checks.map(({ command, exitCode }) => ({
      command,
      exitCode,
    }));
  }
}

export function publicErrorSummary(error: unknown) {
  return error instanceof OperationalError
    ? error.publicMessage.slice(0, 500)
    : "Repository processing failed. Human review is required.";
}
