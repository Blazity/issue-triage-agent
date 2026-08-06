import type { RepositoryConfig } from "./config";
import type { CheckResult, HumanAssessment, IssueSignal } from "./domain";
import { publicErrorSummary } from "./errors";

export type RepositoryOutcome = {
  repositoryKey: string;
  status: "notified" | "pull_request_opened" | "failed";
  summary: string;
  pullRequestUrl?: string;
  assessment?: HumanAssessment;
  checks?: Pick<CheckResult, "command" | "exitCode">[];
};

export type IncidentDependencies = {
  processRepository(
    signal: IssueSignal,
    repository: RepositoryConfig,
  ): Promise<RepositoryOutcome>;
  notify(signal: IssueSignal, outcomes: RepositoryOutcome[]): Promise<void>;
};

export function unmappedRepositoryOutcome(): RepositoryOutcome {
  return {
    repositoryKey: "unmapped",
    status: "notified",
    summary:
      "No configured repository route matched this issue. Human review is required.",
  };
}

export async function executeIncident(
  signal: IssueSignal,
  repositories: RepositoryConfig[],
  dependencies: IncidentDependencies,
) {
  const outcomes =
    repositories.length === 0
      ? [unmappedRepositoryOutcome()]
      : await Promise.all(
          repositories.map(async (repository): Promise<RepositoryOutcome> => {
            try {
              return await dependencies.processRepository(signal, repository);
            } catch (error) {
              return {
                repositoryKey: repository.key,
                status: "failed",
                summary: publicErrorSummary(error),
              };
            }
          }),
        );

  await dependencies.notify(signal, outcomes);

  return { outcomes };
}
