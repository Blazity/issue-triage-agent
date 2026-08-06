import { getWorkflowMetadata, sleep } from "workflow";

import type { IssueSignalStore } from "./admission";
import { repositoryIdentity } from "./config";
import type { RepositoryResult } from "./domain";
import { publicErrorSummary, RepositoryInvestigationError } from "./errors";
import { downloadRepositoryArchive, resolveRepositorySnapshot } from "./github";
import { type RepositoryOutcome, unmappedRepositoryOutcome } from "./incident";
import { createNeonIssueSignalStore } from "./neon-store";
import { investigateAndRepairRepository } from "./repository-agent";
import { publishRepositoryOutcome } from "./repository-processor";
import { config, requireEnabled, workflowRunUrl } from "./runtime";
import { publishFinalSlackMessage, slackIsConfigured } from "./slack";

type RepositoryLease = {
  repositoryIdentity: string;
  fencingToken: string;
  deadlineAt: string;
};

type StoredIssueSignal = NonNullable<
  Awaited<ReturnType<IssueSignalStore["getSignal"]>>
>;

export async function incidentWorkflow(signalId: string) {
  "use workflow";

  const workflow = getWorkflowMetadata();
  let incident = await loadIncident(
    signalId,
    workflow.workflowRunId,
    workflow.workflowStartedAt.toISOString(),
  );

  if (incident.status === "owned") {
    await sleep(new Date(incident.retryAt));
    incident = await loadIncident(
      signalId,
      workflow.workflowRunId,
      incident.retryAt,
    );
  }

  if (incident.status === "completed") {
    await publishCompletedIncidentNotification(signalId, incident.outcomes);
    return { outcomes: incident.outcomes };
  }

  if (incident.status === "owned") {
    throw new IncidentOwnershipConflict();
  }

  const modelStepAllocations = allocateIncidentModelSteps(
    incident.repositoryKeys.length,
    config.limits.maximumModelStepsPerIncident,
  );
  const outcomes =
    incident.repositoryKeys.length === 0
      ? [unmappedRepositoryOutcome()]
      : collectRepositoryOutcomes(
          incident.repositoryKeys,
          await Promise.allSettled(
            incident.repositoryKeys.map((repositoryKey, index) =>
              processConfiguredRepository(
                signalId,
                repositoryKey,
                workflow.workflowRunId,
                incident.deadlineAt,
                modelStepAllocations[index] ?? 0,
              ),
            ),
          ),
        );
  await finalizeIncident(
    signalId,
    workflow.workflowRunId,
    incident.fencingToken,
    outcomes,
  );

  return { outcomes };
}

export async function loadIncident(
  signalId: string,
  workflowRunId: string,
  workflowStartedAt: string,
) {
  "use step";

  requireEnabled();
  const store = createNeonIssueSignalStore();
  const incident = await store.getSignal(signalId);

  if (!incident) {
    throw new Error(`Issue Signal not found: ${signalId}`);
  }

  if (incident.policyVersion !== config.version) {
    throw new Error("Repository policy changed after admission");
  }

  const deadlineAt = new Date(
    resolveIncidentDeadline(
      workflowStartedAt,
      config.limits.maximumRunDurationSeconds,
    ),
  );

  if (deadlineAt.getTime() <= Date.now()) {
    throw new Error("Incident run deadline elapsed");
  }

  const claim = await store.claimIncidentRun(
    signalId,
    workflowRunId,
    deadlineAt,
  );

  if (claim.status === "completed") {
    const completed = await store.getSignal(signalId);

    if (!completed?.outcomes) {
      throw new Error("Completed incident outcomes are unavailable");
    }

    return { status: "completed" as const, outcomes: completed.outcomes };
  }

  if (claim.status === "owned") {
    return {
      status: "owned" as const,
      retryAt: claim.retryAt.toISOString(),
    };
  }

  return {
    status: "claimed" as const,
    repositoryKeys: incident.repositoryKeys,
    fencingToken: claim.fencingToken,
    deadlineAt: deadlineAt.toISOString(),
  };
}

export function resolveIncidentDeadline(
  startedAt: string,
  maximumRunDurationSeconds: number,
) {
  return new Date(
    new Date(startedAt).getTime() + maximumRunDurationSeconds * 1_000,
  ).toISOString();
}

async function processConfiguredRepository(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  incidentDeadlineAt: string,
  maximumIncidentStepsForRepository: number,
): Promise<RepositoryOutcome> {
  if (maximumIncidentStepsForRepository === 0) {
    return {
      repositoryKey,
      status: "notified",
      summary:
        "The incident-wide model-step budget was allocated to other repositories. Human review is required.",
    };
  }

  const begun = await beginRepositoryRun(
    signalId,
    repositoryKey,
    workflowRunId,
    incidentDeadlineAt,
  );

  if (begun.outcome) return begun.outcome;
  if (begun.ownedByAnotherWorkflow) {
    throw new RepositoryOwnershipConflict();
  }
  if (!begun.lease) {
    return {
      repositoryKey,
      status: "failed",
      summary:
        "Repository concurrency limit reached. Human review is required.",
    };
  }

  try {
    const snapshot = await resolveRepositorySnapshotStage(
      signalId,
      repositoryKey,
      workflowRunId,
      begun.lease,
    );
    const result = await investigateRepositoryStage(
      signalId,
      repositoryKey,
      workflowRunId,
      begun.lease,
      snapshot.baseSha,
      maximumIncidentStepsForRepository,
    );
    if (result.status === "failed") {
      return finishRepositoryRun(
        signalId,
        workflowRunId,
        begun.lease,
        result.outcome,
        "failed",
        "repository_investigation_failed",
      );
    }
    const outcome = await publishRepositoryStage(
      signalId,
      repositoryKey,
      workflowRunId,
      begun.lease,
      result.result,
    );

    return finishRepositoryRun(
      signalId,
      workflowRunId,
      begun.lease,
      outcome,
      "completed",
    );
  } catch (error) {
    return finishRepositoryRun(
      signalId,
      workflowRunId,
      begun.lease,
      {
        repositoryKey,
        status: "failed",
        summary: publicErrorSummary(error),
      },
      "failed",
      "repository_processing_failed",
    );
  }
}

export function allocateIncidentModelSteps(
  repositoryCount: number,
  maximumModelSteps: number,
) {
  if (repositoryCount <= 0) return [];

  const base = Math.floor(maximumModelSteps / repositoryCount);
  const remainder = maximumModelSteps % repositoryCount;

  return Array.from(
    { length: repositoryCount },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

export function collectRepositoryOutcomes(
  repositoryKeys: string[],
  settled: PromiseSettledResult<RepositoryOutcome>[],
) {
  const ownershipConflict = settled.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof RepositoryOwnershipConflict,
  );

  if (ownershipConflict?.status === "rejected") {
    throw ownershipConflict.reason;
  }

  return settled.map(
    (result, index): RepositoryOutcome =>
      result.status === "fulfilled"
        ? result.value
        : {
            repositoryKey: repositoryKeys[index] ?? "unknown",
            status: "failed",
            summary: publicErrorSummary(result.reason),
          },
  );
}

export async function beginRepositoryRun(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  incidentDeadlineAt: string,
): Promise<{
  outcome: RepositoryOutcome | null;
  lease: RepositoryLease | null;
  ownedByAnotherWorkflow: boolean;
}> {
  "use step";

  const store = createNeonIssueSignalStore();
  const incident = await store.getSignal(signalId);
  const repository = config.repositories.find(
    ({ key }) => key === repositoryKey,
  );

  if (!incident || !repository) {
    return {
      outcome: {
        repositoryKey,
        status: "failed",
        summary:
          "The admitted issue or repository configuration no longer exists.",
      },
      lease: null,
      ownedByAnotherWorkflow: false,
    };
  }

  if (incident.policyVersion !== config.version) {
    return {
      outcome: {
        repositoryKey,
        status: "failed",
        summary: "Repository policy changed after admission.",
      },
      lease: null,
      ownedByAnotherWorkflow: false,
    };
  }

  const identity = repositoryIdentity(repository);
  const existing = await store.getRepositoryRun(signalId, identity);

  if (existing?.outcome && ["completed", "failed"].includes(existing.stage)) {
    return {
      outcome: existing.outcome,
      lease: null,
      ownedByAnotherWorkflow: false,
    };
  }

  if (
    existing &&
    existing.workflowRunId !== workflowRunId &&
    (!existing.deadlineAt || existing.deadlineAt.getTime() > Date.now())
  ) {
    return {
      outcome: null,
      lease: null,
      ownedByAnotherWorkflow: true,
    };
  }

  const deadlineAt = new Date(incidentDeadlineAt);

  if (deadlineAt.getTime() <= Date.now()) {
    return {
      outcome: {
        repositoryKey,
        status: "failed",
        summary: "Repository run deadline elapsed. Human review is required.",
      },
      lease: null,
      ownedByAnotherWorkflow: false,
    };
  }

  const fencingToken = await store.claimRepositoryLease(
    identity,
    repository.key,
    signalId,
    workflowRunId,
    config.limits.maximumActiveRuns,
    deadlineAt,
    deadlineAt,
  );

  if (!fencingToken) {
    const latest = await store.getRepositoryRun(signalId, identity);

    if (latest?.outcome && ["completed", "failed"].includes(latest.stage)) {
      return {
        outcome: latest.outcome,
        lease: null,
        ownedByAnotherWorkflow: false,
      };
    }
  }

  return {
    outcome: null,
    lease: fencingToken
      ? {
          repositoryIdentity: identity,
          fencingToken,
          deadlineAt: deadlineAt.toISOString(),
        }
      : null,
    ownedByAnotherWorkflow: false,
  };
}

export class RepositoryOwnershipConflict extends Error {
  constructor() {
    super("Repository run is already owned by another workflow");
    this.name = "RepositoryOwnershipConflict";
  }
}

export class IncidentOwnershipConflict extends Error {
  constructor() {
    super("Incident run is already owned by another workflow");
    this.name = "IncidentOwnershipConflict";
  }
}

export async function resolveRepositorySnapshotStage(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  lease: RepositoryLease,
) {
  "use step";

  const { repository } = await renewAndLoadRepository(
    signalId,
    repositoryKey,
    workflowRunId,
    lease,
  );

  return resolveRepositorySnapshot(repository, lease.deadlineAt);
}

export async function investigateRepositoryStage(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  lease: RepositoryLease,
  baseSha: string,
  maximumIncidentStepsForRepository: number,
) {
  "use step";

  const { store, incident, repository } = await renewAndLoadRepository(
    signalId,
    repositoryKey,
    workflowRunId,
    lease,
  );
  const snapshot = await downloadRepositoryArchiveBeforeModel(
    repository,
    lease.deadlineAt,
    baseSha,
  );
  const remainingSeconds = remainingRunSeconds(lease.deadlineAt);
  let result: RepositoryResult;

  try {
    result = await investigateAndRepairRepository({
      ...snapshot,
      repository,
      signal: incident.signal,
      maximumAgentSteps: Math.min(
        maximumIncidentStepsForRepository,
        config.limits.maximumModelStepsPerRepository,
      ),
      maximumRunDurationSeconds: remainingSeconds,
    });
  } catch (error) {
    if (error instanceof RepositoryInvestigationError) {
      return {
        status: "failed" as const,
        outcome: {
          repositoryKey,
          status: "failed" as const,
          summary: error.publicMessage,
          checks: error.checks,
        },
      };
    }

    throw error;
  }
  await requireRepositoryRunAdvance(
    store.advanceRepositoryRun(
      signalId,
      lease.repositoryIdentity,
      workflowRunId,
      lease.fencingToken,
      {
        stage: "investigated",
        candidateDigest: result.repair?.digest,
      },
    ),
  );

  return { status: "completed" as const, result };
}

async function downloadRepositoryArchiveBeforeModel(
  repository: Parameters<typeof downloadRepositoryArchive>[0],
  deadlineAt: string,
  baseSha: string,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await downloadRepositoryArchive(repository, deadlineAt, baseSha);
    } catch (error) {
      lastError = error;

      if (attempt === 3 || !isTransientGitHubFailure(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function isTransientGitHubFailure(error: unknown) {
  if (error instanceof TypeError || error instanceof DOMException) return true;

  return (
    error instanceof Error &&
    /\((408|409|425|429|5\d\d)\)|timed? ?out|timeout/i.test(error.message)
  );
}

export async function publishRepositoryStage(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  lease: RepositoryLease,
  result: RepositoryResult,
) {
  "use step";

  const { store, incident, repository } = await renewAndLoadRepository(
    signalId,
    repositoryKey,
    workflowRunId,
    lease,
  );
  remainingRunSeconds(lease.deadlineAt);
  await requireRepositoryRunAdvance(
    store.advanceRepositoryRun(
      signalId,
      lease.repositoryIdentity,
      workflowRunId,
      lease.fencingToken,
      {
        stage: "publishing",
        candidateDigest: result.repair?.digest,
      },
    ),
  );

  return publishRepositoryOutcome(incident.signal, repository, result, {
    deadlineAt: lease.deadlineAt,
    authorizePullRequest: () =>
      store.claimPullRequestBudget(
        lease.repositoryIdentity,
        signalId,
        config.limits.maximumPullRequestsPerRepositoryPerDay,
        new Date(),
      ),
  });
}

export async function finishRepositoryRun(
  signalId: string,
  workflowRunId: string,
  lease: RepositoryLease,
  outcome: RepositoryOutcome,
  stage: "completed" | "failed",
  lastErrorCode?: string,
) {
  "use step";

  const finished = await createNeonIssueSignalStore().finishRepositoryRun(
    signalId,
    lease.repositoryIdentity,
    workflowRunId,
    lease.fencingToken,
    { stage, outcome, lastErrorCode },
  );

  if (!finished) {
    throw new Error("Repository run ownership was lost before completion");
  }

  return outcome;
}

async function renewAndLoadRepository(
  signalId: string,
  repositoryKey: string,
  workflowRunId: string,
  lease: RepositoryLease,
) {
  const store = createNeonIssueSignalStore();
  const incident = await store.getSignal(signalId);
  const repository = config.repositories.find(
    ({ key }) => key === repositoryKey,
  );

  if (!incident || !repository) {
    throw new Error("Issue Signal or repository configuration is unavailable");
  }

  const deadlineAt = new Date(lease.deadlineAt);
  remainingRunSeconds(lease.deadlineAt);
  const renewed = await store.renewRepositoryLease(
    lease.repositoryIdentity,
    signalId,
    workflowRunId,
    lease.fencingToken,
    deadlineAt,
  );

  if (!renewed) {
    throw new Error("Repository run lease was lost");
  }

  return { store, incident, repository };
}

function remainingRunSeconds(deadlineAt: string) {
  const milliseconds = new Date(deadlineAt).getTime() - Date.now();

  if (milliseconds <= 0) {
    throw new Error("Repository run deadline elapsed");
  }

  return Math.max(1, Math.floor(milliseconds / 1_000));
}

async function requireRepositoryRunAdvance(operation: Promise<boolean>) {
  if (!(await operation)) {
    throw new Error("Repository run ownership was lost");
  }
}

export async function finalizeIncident(
  signalId: string,
  workflowRunId: string,
  fencingToken: string,
  outcomes: RepositoryOutcome[],
) {
  "use step";

  const store = createNeonIssueSignalStore();
  const incident = await store.getSignal(signalId);

  if (!incident) {
    throw new Error(`Issue Signal not found: ${signalId}`);
  }

  const saved = await store.saveIncidentOutcomes(
    signalId,
    workflowRunId,
    fencingToken,
    outcomes,
  );

  if (!saved) {
    throw new Error("Incident run ownership was lost before finalization");
  }

  await publishFinalIncidentNotification(store, signalId, incident, outcomes);
}

export async function publishCompletedIncidentNotification(
  signalId: string,
  outcomes: RepositoryOutcome[],
) {
  "use step";

  const store = createNeonIssueSignalStore();
  const incident = await store.getSignal(signalId);

  if (!incident) {
    throw new Error(`Issue Signal not found: ${signalId}`);
  }

  await publishFinalIncidentNotification(store, signalId, incident, outcomes);
}

async function publishFinalIncidentNotification(
  store: IssueSignalStore,
  signalId: string,
  incident: StoredIssueSignal,
  outcomes: RepositoryOutcome[],
) {
  if (!slackIsConfigured() || !(await store.claimNotification(signalId))) {
    return;
  }

  try {
    await publishFinalSlackMessage(
      incident.signal,
      outcomes,
      await store.getSlackMessageTimestamp(signalId),
      workflowRunUrl(incident.workflowRunId),
    );
    await store.markNotified(signalId);
  } catch (error) {
    await store.releaseNotificationClaim(signalId);
    throw error;
  }
}

loadIncident.maxRetries = 2;
beginRepositoryRun.maxRetries = 2;
resolveRepositorySnapshotStage.maxRetries = 2;
investigateRepositoryStage.maxRetries = 0;
publishRepositoryStage.maxRetries = 2;
finishRepositoryRun.maxRetries = 2;
finalizeIncident.maxRetries = 2;
publishCompletedIncidentNotification.maxRetries = 2;
