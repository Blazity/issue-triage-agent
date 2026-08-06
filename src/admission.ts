import { createHash, randomUUID } from "node:crypto";

import type { IssueSignal } from "./domain";
import type { RepositoryOutcome } from "./incident";

export type AdmissionRequest = {
  signal: IssueSignal;
  repositoryKeys: string[];
  signalId: string;
  idempotencyKey: string;
  incidentKey: string;
  policyVersion: string;
  admittedAt: Date;
  expiresAt: Date;
  sourceEventsPerMinute: number;
};

export type AdmissionStoreResult =
  | { status: "accepted"; signalId: string }
  | { status: "duplicate"; signalId: string }
  | { status: "suppressed"; reason: "source_rate_limit" };

export type AdmissionStore = {
  admit(request: AdmissionRequest): Promise<AdmissionStoreResult>;
};

export type IncidentRunClaim =
  | { status: "claimed"; fencingToken: string }
  | { status: "completed" }
  | { status: "owned"; retryAt: Date };

export type IssueSignalStore = AdmissionStore & {
  getSignal(signalId: string): Promise<{
    signal: IssueSignal;
    repositoryKeys: string[];
    policyVersion: string;
    workflowRunId: string | null;
    outcomes: RepositoryOutcome[] | null;
  } | null>;
  claimWorkflowStart(
    signalId: string,
    claimId: string,
  ): Promise<{ claimed: boolean; runId: string | null }>;
  markWorkflowStarted(
    signalId: string,
    claimId: string,
    runId: string,
  ): Promise<void>;
  releaseWorkflowStartClaim(signalId: string, claimId: string): Promise<void>;
  claimIncidentRun(
    signalId: string,
    workflowRunId: string,
    expiresAt: Date,
  ): Promise<IncidentRunClaim>;
  saveIncidentOutcomes(
    signalId: string,
    workflowRunId: string,
    fencingToken: string,
    outcomes: RepositoryOutcome[],
  ): Promise<boolean>;
  claimNotification(signalId: string): Promise<boolean>;
  releaseNotificationClaim(signalId: string): Promise<void>;
  markNotified(signalId: string): Promise<void>;
  claimInitialNotification(signalId: string): Promise<boolean>;
  releaseInitialNotificationClaim(signalId: string): Promise<void>;
  saveSlackMessageTimestamp(signalId: string, timestamp: string): Promise<void>;
  getSlackMessageTimestamp(signalId: string): Promise<string | null>;
  claimRepositoryLease(
    repositoryIdentity: string,
    repositoryKey: string,
    signalId: string,
    workflowRunId: string,
    maximumActiveRuns: number,
    expiresAt: Date,
    deadlineAt: Date,
  ): Promise<string | null>;
  renewRepositoryLease(
    repositoryIdentity: string,
    signalId: string,
    workflowRunId: string,
    fencingToken: string,
    expiresAt: Date,
  ): Promise<boolean>;
  claimPullRequestBudget(
    repositoryIdentity: string,
    signalId: string,
    dailyLimit: number,
    now: Date,
  ): Promise<boolean>;
  getRepositoryRun(
    signalId: string,
    repositoryIdentity: string,
  ): Promise<{
    stage: string;
    outcome: RepositoryOutcome | null;
    candidateDigest: string | null;
    deadlineAt: Date | null;
    workflowRunId: string | null;
  } | null>;
  advanceRepositoryRun(
    signalId: string,
    repositoryIdentity: string,
    workflowRunId: string,
    fencingToken: string,
    update: {
      stage: string;
      outcome?: RepositoryOutcome;
      candidateDigest?: string;
      lastErrorCode?: string;
    },
  ): Promise<boolean>;
  finishRepositoryRun(
    signalId: string,
    repositoryIdentity: string,
    workflowRunId: string,
    fencingToken: string,
    update: {
      stage: "completed" | "failed";
      outcome: RepositoryOutcome;
      lastErrorCode?: string;
    },
  ): Promise<boolean>;
  cleanupExpiredRecords(): Promise<{
    deletedSignals: number;
    deletedRateWindows: number;
  }>;
};

export type AdmissionResult =
  | AdmissionStoreResult
  | { status: "ignored"; reason: "recursive_event" };

type AdmissionOptions = {
  now: Date;
  sourceEventsPerMinute: number;
  policyVersion?: string;
};

function hash(parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function normalizeTitle(title: string) {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function incidentWindow(occurredAt: string) {
  const timestamp = Date.parse(occurredAt);

  return Number.isFinite(timestamp)
    ? String(Math.floor(timestamp / (60 * 60 * 1_000)))
    : occurredAt;
}

export async function admitIssueSignal(
  signal: IssueSignal,
  repositoryKeys: string[],
  store: AdmissionStore,
  options: AdmissionOptions,
): Promise<AdmissionResult> {
  if (
    signal.origin?.generatedBy === "issue-triage-agent" ||
    (signal.origin?.runDepth ?? 0) >= 1
  ) {
    return { status: "ignored", reason: "recursive_event" };
  }

  return store.admit({
    signal,
    repositoryKeys,
    signalId: randomUUID(),
    idempotencyKey: hash([
      signal.source,
      signal.sourceAccount,
      signal.sourceEventId,
    ]),
    incidentKey: hash([
      signal.source,
      signal.sourceAccount,
      ...repositoryKeys.toSorted(),
      normalizeTitle(signal.title),
      incidentWindow(signal.occurredAt),
    ]),
    policyVersion: options.policyVersion ?? "1",
    admittedAt: options.now,
    expiresAt: new Date(options.now.getTime() + 7 * 24 * 60 * 60 * 1_000),
    sourceEventsPerMinute: options.sourceEventsPerMinute,
  });
}

export function createInMemoryAdmissionStore(): IssueSignalStore {
  const deliveries = new Map<string, string>();
  const incidents = new Map<string, string>();
  const sourceWindows = new Map<string, number>();
  const records = new Map<
    string,
    AdmissionRequest & {
      workflowClaimId?: string;
      workflowRunId?: string;
      outcomes?: RepositoryOutcome[];
      incidentWorkflowRunId?: string;
      incidentFencingToken?: string;
      incidentLeaseExpiresAt?: Date;
      initialNotificationClaimed?: boolean;
      slackMessageTimestamp?: string;
      notificationClaimed?: boolean;
      notified?: boolean;
    }
  >();
  const repositoryLeases = new Map<
    string,
    {
      signalId: string;
      workflowRunId: string;
      fencingToken: string;
      expiresAt: Date;
    }
  >();
  const pullRequestClaims = new Map<string, Set<string>>();
  const repositoryRuns = new Map<
    string,
    {
      stage: string;
      outcome: RepositoryOutcome | null;
      candidateDigest: string | null;
      deadlineAt: Date;
      workflowRunId: string;
      fencingToken: string;
    }
  >();

  return {
    async admit(request) {
      const existingSignalId =
        deliveries.get(request.idempotencyKey) ??
        incidents.get(request.incidentKey);

      if (existingSignalId) {
        return { status: "duplicate", signalId: existingSignalId };
      }

      const minute = Math.floor(request.admittedAt.getTime() / 60_000);
      const sourceWindowKey = `${request.signal.source}:${request.signal.sourceAccount}:${minute}`;
      const acceptedInWindow = sourceWindows.get(sourceWindowKey) ?? 0;

      if (acceptedInWindow >= request.sourceEventsPerMinute) {
        return { status: "suppressed", reason: "source_rate_limit" };
      }

      deliveries.set(request.idempotencyKey, request.signalId);
      incidents.set(request.incidentKey, request.signalId);
      sourceWindows.set(sourceWindowKey, acceptedInWindow + 1);
      records.set(request.signalId, request);

      return { status: "accepted", signalId: request.signalId };
    },
    async getSignal(signalId) {
      const record = records.get(signalId);
      return record
        ? {
            signal: record.signal,
            repositoryKeys: record.repositoryKeys,
            policyVersion: record.policyVersion,
            workflowRunId: record.workflowRunId ?? null,
            outcomes: record.outcomes ?? null,
          }
        : null;
    },
    async claimWorkflowStart(signalId, claimId) {
      const record = records.get(signalId);

      if (!record) {
        throw new Error(`Issue Signal not found: ${signalId}`);
      }

      if (record.workflowRunId || record.workflowClaimId) {
        return { claimed: false, runId: record.workflowRunId ?? null };
      }

      record.workflowClaimId = claimId;
      return { claimed: true, runId: null };
    },
    async markWorkflowStarted(signalId, claimId, runId) {
      const record = records.get(signalId);

      if (
        !record ||
        record.workflowClaimId !== claimId ||
        record.workflowRunId
      ) {
        throw new Error(`Workflow start claim was lost: ${signalId}`);
      }

      record.workflowRunId = runId;
      record.workflowClaimId = undefined;
    },
    async releaseWorkflowStartClaim(signalId, claimId) {
      const record = records.get(signalId);

      if (record?.workflowClaimId === claimId && !record.workflowRunId) {
        record.workflowClaimId = undefined;
      }
    },
    async claimIncidentRun(signalId, workflowRunId, expiresAt) {
      const record = records.get(signalId);

      if (!record) {
        throw new Error(`Issue Signal not found: ${signalId}`);
      }

      if (record.outcomes) {
        return { status: "completed" };
      }

      if (
        record.incidentWorkflowRunId &&
        record.incidentWorkflowRunId !== workflowRunId &&
        record.incidentLeaseExpiresAt &&
        record.incidentLeaseExpiresAt.getTime() > Date.now()
      ) {
        return {
          status: "owned",
          retryAt: record.incidentLeaseExpiresAt,
        };
      }

      if (
        record.incidentWorkflowRunId === workflowRunId &&
        record.incidentFencingToken &&
        record.incidentLeaseExpiresAt &&
        record.incidentLeaseExpiresAt.getTime() > Date.now()
      ) {
        return {
          status: "claimed",
          fencingToken: record.incidentFencingToken,
        };
      }

      record.incidentWorkflowRunId = workflowRunId;
      record.incidentFencingToken = randomUUID();
      record.incidentLeaseExpiresAt = expiresAt;

      return {
        status: "claimed",
        fencingToken: record.incidentFencingToken,
      };
    },
    async saveIncidentOutcomes(
      signalId,
      workflowRunId,
      fencingToken,
      outcomes,
    ) {
      const record = records.get(signalId);

      if (
        !record ||
        record.outcomes ||
        record.incidentWorkflowRunId !== workflowRunId ||
        record.incidentFencingToken !== fencingToken ||
        !record.incidentLeaseExpiresAt ||
        record.incidentLeaseExpiresAt.getTime() <= Date.now()
      ) {
        return false;
      }

      record.outcomes = outcomes;
      return true;
    },
    async claimNotification(signalId) {
      const record = records.get(signalId);

      if (!record || record.notificationClaimed || record.notified) {
        return false;
      }

      record.notificationClaimed = true;
      return true;
    },
    async markNotified(signalId) {
      const record = records.get(signalId);

      if (!record?.notificationClaimed) {
        throw new Error(`Notification claim was lost: ${signalId}`);
      }

      record.notified = true;
      record.notificationClaimed = false;
    },
    async releaseNotificationClaim(signalId) {
      const record = records.get(signalId);

      if (record && !record.notified) {
        record.notificationClaimed = false;
      }
    },
    async claimInitialNotification(signalId) {
      const record = records.get(signalId);

      if (
        !record ||
        record.initialNotificationClaimed ||
        record.slackMessageTimestamp
      ) {
        return false;
      }

      record.initialNotificationClaimed = true;
      return true;
    },
    async saveSlackMessageTimestamp(signalId, timestamp) {
      const record = records.get(signalId);

      if (!record?.initialNotificationClaimed) {
        throw new Error(`Initial notification claim was lost: ${signalId}`);
      }

      record.slackMessageTimestamp = timestamp;
      record.initialNotificationClaimed = false;
    },
    async releaseInitialNotificationClaim(signalId) {
      const record = records.get(signalId);

      if (record && !record.slackMessageTimestamp) {
        record.initialNotificationClaimed = false;
      }
    },
    async getSlackMessageTimestamp(signalId) {
      return records.get(signalId)?.slackMessageTimestamp ?? null;
    },
    async claimRepositoryLease(
      repositoryIdentity,
      _repositoryKey,
      signalId,
      workflowRunId,
      maximumActiveRuns,
      expiresAt,
      deadlineAt,
    ) {
      const now = Date.now();

      for (const [key, lease] of repositoryLeases) {
        if (lease.expiresAt.getTime() <= now) {
          repositoryLeases.delete(key);
        }
      }

      const existing = repositoryLeases.get(repositoryIdentity);

      if (existing) {
        return existing.signalId === signalId &&
          existing.workflowRunId === workflowRunId
          ? existing.fencingToken
          : null;
      }

      if (repositoryLeases.size >= maximumActiveRuns) {
        return null;
      }

      const fencingToken = randomUUID();
      repositoryLeases.set(repositoryIdentity, {
        signalId,
        workflowRunId,
        fencingToken,
        expiresAt,
      });
      const runKey = `${signalId}:${repositoryIdentity}`;
      const existingRun = repositoryRuns.get(runKey);
      repositoryRuns.set(runKey, {
        stage:
          existingRun?.stage === "completed" || existingRun?.stage === "failed"
            ? existingRun.stage
            : "claimed",
        outcome: existingRun?.outcome ?? null,
        candidateDigest: existingRun?.candidateDigest ?? null,
        deadlineAt,
        workflowRunId,
        fencingToken,
      });
      return fencingToken;
    },
    async renewRepositoryLease(
      repositoryIdentity,
      signalId,
      workflowRunId,
      fencingToken,
      expiresAt,
    ) {
      const lease = repositoryLeases.get(repositoryIdentity);

      if (
        lease?.signalId !== signalId ||
        lease.workflowRunId !== workflowRunId ||
        lease.fencingToken !== fencingToken ||
        lease.expiresAt.getTime() <= Date.now()
      ) {
        return false;
      }

      lease.expiresAt = expiresAt;
      return true;
    },
    async claimPullRequestBudget(
      repositoryIdentity,
      signalId,
      dailyLimit,
      now,
    ) {
      const day = now.toISOString().slice(0, 10);
      const key = `${repositoryIdentity}:${day}`;
      const claims = pullRequestClaims.get(key) ?? new Set<string>();

      if (claims.has(signalId)) {
        return true;
      }

      if (claims.size >= dailyLimit) {
        return false;
      }

      claims.add(signalId);
      pullRequestClaims.set(key, claims);
      return true;
    },
    async getRepositoryRun(signalId, repositoryIdentity) {
      const run = repositoryRuns.get(`${signalId}:${repositoryIdentity}`);

      return run
        ? {
            stage: run.stage,
            outcome: run.outcome,
            candidateDigest: run.candidateDigest,
            deadlineAt: run.deadlineAt,
            workflowRunId: run.workflowRunId,
          }
        : null;
    },
    async advanceRepositoryRun(
      signalId,
      repositoryIdentity,
      workflowRunId,
      fencingToken,
      update,
    ) {
      const run = repositoryRuns.get(`${signalId}:${repositoryIdentity}`);
      const lease = repositoryLeases.get(repositoryIdentity);

      if (
        !run ||
        !lease ||
        run.workflowRunId !== workflowRunId ||
        run.fencingToken !== fencingToken ||
        lease.expiresAt.getTime() <= Date.now() ||
        run.deadlineAt.getTime() <= Date.now()
      ) {
        return false;
      }

      run.stage = update.stage;
      run.outcome = update.outcome ?? run.outcome;
      run.candidateDigest = update.candidateDigest ?? run.candidateDigest;
      return true;
    },
    async finishRepositoryRun(
      signalId,
      repositoryIdentity,
      workflowRunId,
      fencingToken,
      update,
    ) {
      const run = repositoryRuns.get(`${signalId}:${repositoryIdentity}`);

      if (
        !run ||
        run.workflowRunId !== workflowRunId ||
        run.fencingToken !== fencingToken
      ) {
        return false;
      }

      run.stage = update.stage;
      run.outcome = update.outcome;
      repositoryLeases.delete(repositoryIdentity);
      return true;
    },
    async cleanupExpiredRecords() {
      const now = Date.now();
      let deletedSignals = 0;

      for (const [signalId, record] of records) {
        if (record.expiresAt.getTime() <= now) {
          records.delete(signalId);
          deliveries.delete(record.idempotencyKey);
          incidents.delete(record.incidentKey);
          deletedSignals += 1;
        }
      }

      return { deletedSignals, deletedRateWindows: 0 };
    },
  };
}
