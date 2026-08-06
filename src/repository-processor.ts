import type { RepositoryConfig } from "./config";
import type { IssueSignal } from "./domain";
import { createOrFindPullRequest, downloadRepositoryArchive } from "./github";
import type { RepositoryOutcome } from "./incident";
import { evaluateRepositoryAction } from "./policy";
import { investigateAndRepairRepository } from "./repository-agent";

export async function investigateRepository(
  signal: IssueSignal,
  repository: RepositoryConfig,
  options: {
    maximumAgentSteps?: number;
    maximumRunDurationSeconds?: number;
  } = {},
) {
  const snapshot = await downloadRepositoryArchive(repository);
  return investigateAndRepairRepository({
    ...snapshot,
    repository,
    signal,
    maximumAgentSteps: options.maximumAgentSteps ?? 4,
    maximumRunDurationSeconds: options.maximumRunDurationSeconds ?? 600,
  });
}

export async function publishRepositoryOutcome(
  signal: IssueSignal,
  repository: RepositoryConfig,
  result: Awaited<ReturnType<typeof investigateRepository>>,
  options: {
    authorizePullRequest?: () => Promise<boolean>;
    deadlineAt?: string;
  } = {},
): Promise<RepositoryOutcome> {
  const decision = evaluateRepositoryAction(repository, result);

  if (decision.action === "notify" || !result.repair) {
    return {
      repositoryKey: repository.key,
      status: "notified",
      summary: `${result.investigation.summary} Automatic repair stopped: ${decision.reason}.`,
      assessment: result.investigation,
      checks: result.checks,
    };
  }

  if (options.authorizePullRequest && !(await options.authorizePullRequest())) {
    return {
      repositoryKey: repository.key,
      status: "notified",
      summary: `${result.investigation.summary} Automatic repair stopped: pull_request_budget_exhausted.`,
      assessment: result.investigation,
      checks: result.checks,
    };
  }

  const pullRequest = await createOrFindPullRequest(
    signal,
    repository,
    result.repair,
    options.deadlineAt,
  );

  return {
    repositoryKey: repository.key,
    status: "pull_request_opened",
    summary: `${result.investigation.summary} ${result.repair.summary}`,
    pullRequestUrl: pullRequest.url,
    assessment: result.investigation,
    checks: result.checks,
  };
}

export async function processRepository(
  signal: IssueSignal,
  repository: RepositoryConfig,
  options: {
    authorizePullRequest?: () => Promise<boolean>;
    maximumAgentSteps?: number;
    maximumRunDurationSeconds?: number;
  } = {},
) {
  const result = await investigateRepository(signal, repository, options);

  return publishRepositoryOutcome(signal, repository, result, options);
}
