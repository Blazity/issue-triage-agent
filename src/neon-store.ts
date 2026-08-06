import { randomUUID } from "node:crypto";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import type {
  AdmissionRequest,
  AdmissionStoreResult,
  IssueSignalStore,
} from "./admission";
import type { IssueSignal } from "./domain";
import type { RepositoryOutcome } from "./incident";

let sharedSql: NeonQueryFunction<false, false> | undefined;

function database(databaseUrl?: string) {
  if (databaseUrl) {
    return neon(databaseUrl);
  }

  const configuredUrl = process.env.DATABASE_URL;

  if (!configuredUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return (sharedSql ??= neon(configuredUrl));
}

export async function checkNeonReadiness(databaseUrl?: string) {
  const sql = database(databaseUrl);
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM schema_migrations
      WHERE name = '008_incident_recovery_schedule.sql'
    ) AS migrated
  `;

  return Boolean((rows[0] as { migrated: boolean } | undefined)?.migrated);
}

async function admit(
  request: AdmissionRequest,
  sql: NeonQueryFunction<false, false>,
): Promise<AdmissionStoreResult> {
  const rows = await sql`
    SELECT status, signal_id AS "signalId", reason
    FROM admit_issue_signal(
      ${request.signalId}::uuid,
      ${request.idempotencyKey},
      ${request.incidentKey},
      ${request.policyVersion},
      ${request.signal.source},
      ${request.signal.sourceAccount},
      ${request.repositoryKeys}::text[],
      ${JSON.stringify(request.signal)}::jsonb,
      ${request.admittedAt.toISOString()}::timestamptz,
      ${request.expiresAt.toISOString()}::timestamptz,
      ${request.sourceEventsPerMinute}
    )
  `;
  const result = rows[0] as
    | { status: "accepted" | "duplicate"; signalId: string; reason: null }
    | { status: "suppressed"; signalId: null; reason: "source_rate_limit" }
    | undefined;

  if (!result) {
    throw new Error("Admission did not return a result");
  }

  return result.status === "suppressed"
    ? { status: "suppressed", reason: result.reason }
    : { status: result.status, signalId: result.signalId };
}

export function createNeonIssueSignalStore(
  databaseUrl?: string,
): IssueSignalStore {
  const sql = database(databaseUrl);

  return {
    admit: (request) => admit(request, sql),
    async getSignal(signalId) {
      const rows = await sql`
        SELECT
          signal,
          repository_keys AS "repositoryKeys",
          policy_version AS "policyVersion",
          workflow_run_id AS "workflowRunId",
          outcomes
        FROM issue_signals
        WHERE signal_id = ${signalId}::uuid AND expires_at > now()
        LIMIT 1
      `;
      const result = rows[0] as
        | {
            signal: IssueSignal;
            repositoryKeys: string[];
            policyVersion: string;
            workflowRunId: string | null;
            outcomes: RepositoryOutcome[] | null;
          }
        | undefined;

      return result ?? null;
    },
    async claimWorkflowStart(signalId, claimId) {
      const rows = await sql`
        WITH claimed AS (
          UPDATE issue_signals
          SET workflow_start_claim_id = ${claimId}::uuid,
              workflow_start_claimed_at = now()
          WHERE signal_id = ${signalId}::uuid
            AND workflow_run_id IS NULL
            AND (
              workflow_start_claim_id IS NULL
              OR workflow_start_claimed_at < now() - interval '5 minutes'
            )
          RETURNING workflow_run_id
        )
        SELECT true AS claimed, workflow_run_id AS "runId" FROM claimed
        UNION ALL
        SELECT false AS claimed, workflow_run_id AS "runId"
        FROM issue_signals
        WHERE signal_id = ${signalId}::uuid
          AND NOT EXISTS (SELECT 1 FROM claimed)
        LIMIT 1
      `;
      const result = rows[0] as
        | { claimed: boolean; runId: string | null }
        | undefined;

      if (!result) {
        throw new Error(`Issue Signal not found: ${signalId}`);
      }

      return result;
    },
    async markWorkflowStarted(signalId, claimId, runId) {
      const rows = await sql`
        UPDATE issue_signals
        SET workflow_run_id = ${runId},
            workflow_start_claim_id = NULL,
            workflow_start_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND workflow_start_claim_id = ${claimId}::uuid
          AND workflow_run_id IS NULL
        RETURNING signal_id
      `;

      if (!rows[0]) {
        throw new Error(`Workflow start claim was lost: ${signalId}`);
      }
    },
    async releaseWorkflowStartClaim(signalId, claimId) {
      await sql`
        UPDATE issue_signals
        SET workflow_start_claim_id = NULL,
            workflow_start_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND workflow_start_claim_id = ${claimId}::uuid
          AND workflow_run_id IS NULL
      `;
    },
    async claimIncidentRun(signalId, workflowRunId, expiresAt) {
      const fencingToken = randomUUID();
      const rows = await sql`
        SELECT
          status,
          fencing_token AS "fencingToken",
          retry_at AS "retryAt"
        FROM claim_incident_run(
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${expiresAt.toISOString()}::timestamptz
        )
      `;
      const result = rows[0] as
        | {
            status: "claimed" | "completed" | "owned";
            fencingToken: string | null;
            retryAt: string | null;
          }
        | undefined;

      if (!result) {
        throw new Error(`Issue Signal not found: ${signalId}`);
      }

      if (result.status === "claimed" && result.fencingToken) {
        return { status: "claimed", fencingToken: result.fencingToken };
      }

      if (result.status === "owned" && result.retryAt) {
        return { status: "owned", retryAt: new Date(result.retryAt) };
      }

      return { status: "completed" };
    },
    async saveIncidentOutcomes(
      signalId,
      workflowRunId,
      fencingToken,
      outcomes: RepositoryOutcome[],
    ) {
      const rows = await sql`
        SELECT save_incident_outcomes(
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${JSON.stringify(outcomes)}::jsonb
        ) AS saved
      `;

      return Boolean((rows[0] as { saved: boolean } | undefined)?.saved);
    },
    async claimInitialNotification(signalId) {
      const rows = await sql`
        UPDATE issue_signals
        SET initial_notification_claimed_at = now()
        WHERE signal_id = ${signalId}::uuid
          AND (
            initial_notification_claimed_at IS NULL
            OR initial_notification_claimed_at < now() - interval '5 minutes'
          )
          AND slack_message_ts IS NULL
        RETURNING signal_id
      `;

      return Boolean(rows[0]);
    },
    async saveSlackMessageTimestamp(signalId, timestamp) {
      const rows = await sql`
        UPDATE issue_signals
        SET slack_message_ts = ${timestamp},
            initial_notification_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND initial_notification_claimed_at IS NOT NULL
          AND slack_message_ts IS NULL
        RETURNING signal_id
      `;

      if (!rows[0]) {
        throw new Error(`Initial notification claim was lost: ${signalId}`);
      }
    },
    async releaseInitialNotificationClaim(signalId) {
      await sql`
        UPDATE issue_signals
        SET initial_notification_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND slack_message_ts IS NULL
      `;
    },
    async getSlackMessageTimestamp(signalId) {
      const rows = await sql`
        SELECT slack_message_ts AS "timestamp"
        FROM issue_signals
        WHERE signal_id = ${signalId}::uuid
        LIMIT 1
      `;

      return (
        (rows[0] as { timestamp: string | null } | undefined)?.timestamp ?? null
      );
    },
    async claimNotification(signalId) {
      const rows = await sql`
        UPDATE issue_signals
        SET notification_claimed_at = now()
        WHERE signal_id = ${signalId}::uuid
          AND (
            notification_claimed_at IS NULL
            OR notification_claimed_at < now() - interval '5 minutes'
          )
          AND notified_at IS NULL
        RETURNING signal_id
      `;

      return Boolean(rows[0]);
    },
    async markNotified(signalId) {
      const rows = await sql`
        UPDATE issue_signals
        SET notified_at = now(), notification_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND notification_claimed_at IS NOT NULL
          AND notified_at IS NULL
        RETURNING signal_id
      `;

      if (!rows[0]) {
        throw new Error(`Notification claim was lost: ${signalId}`);
      }
    },
    async releaseNotificationClaim(signalId) {
      await sql`
        UPDATE issue_signals
        SET notification_claimed_at = NULL
        WHERE signal_id = ${signalId}::uuid
          AND notified_at IS NULL
      `;
    },
    async claimRepositoryLease(
      repositoryIdentity,
      repositoryKey,
      signalId,
      workflowRunId,
      maximumActiveRuns,
      expiresAt,
      deadlineAt,
    ) {
      const fencingToken = randomUUID();
      const rows = await sql`
        SELECT claim_repository_run_lease_v2(
          ${repositoryIdentity},
          ${repositoryKey},
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${maximumActiveRuns},
          ${expiresAt.toISOString()}::timestamptz,
          ${deadlineAt.toISOString()}::timestamptz
        ) AS "fencingToken"
      `;
      const claimed = (rows[0] as { fencingToken: string | null } | undefined)
        ?.fencingToken;

      return claimed ?? null;
    },
    async renewRepositoryLease(
      repositoryIdentity,
      signalId,
      workflowRunId,
      fencingToken,
      expiresAt,
    ) {
      const rows = await sql`
        SELECT renew_repository_run_lease_v2(
          ${repositoryIdentity},
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${expiresAt.toISOString()}::timestamptz
        ) AS renewed
      `;

      return Boolean((rows[0] as { renewed: boolean } | undefined)?.renewed);
    },
    async claimPullRequestBudget(
      repositoryIdentity,
      signalId,
      dailyLimit,
      now,
    ) {
      const claimDay = now.toISOString().slice(0, 10);
      const lockKey = `${repositoryIdentity}:${claimDay}:pull-requests`;
      const rows = await sql`
        WITH budget_lock AS (
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        ),
        cleanup AS (
          DELETE FROM pull_request_budget_claims_v2
          WHERE claim_day < current_date - 7
        ),
        claimed AS (
          INSERT INTO pull_request_budget_claims_v2 (
            repository_identity,
            signal_id,
            claim_day
          )
          SELECT ${repositoryIdentity}, ${signalId}::uuid, ${claimDay}::date
          FROM budget_lock
          WHERE (
            SELECT count(*)
            FROM pull_request_budget_claims_v2
            WHERE repository_identity = ${repositoryIdentity}
              AND claim_day = ${claimDay}::date
          ) < ${dailyLimit}
          OR EXISTS (
            SELECT 1
            FROM pull_request_budget_claims_v2
            WHERE repository_identity = ${repositoryIdentity}
              AND signal_id = ${signalId}::uuid
              AND claim_day = ${claimDay}::date
          )
          ON CONFLICT (repository_identity, signal_id, claim_day)
          DO UPDATE SET signal_id = EXCLUDED.signal_id
          RETURNING repository_identity
        )
        SELECT repository_identity FROM claimed
      `;

      return Boolean(rows[0]);
    },
    async getRepositoryRun(signalId, repositoryIdentity) {
      const rows = await sql`
        SELECT
          stage,
          outcome,
          candidate_digest AS "candidateDigest",
          deadline_at AS "deadlineAt",
          workflow_run_id AS "workflowRunId"
        FROM repository_runs
        WHERE signal_id = ${signalId}::uuid
          AND repository_identity = ${repositoryIdentity}
        LIMIT 1
      `;
      const result = rows[0] as
        | {
            stage: string;
            outcome: RepositoryOutcome | null;
            candidateDigest: string | null;
            deadlineAt: string | Date | null;
            workflowRunId: string | null;
          }
        | undefined;

      return result
        ? {
            ...result,
            deadlineAt: result.deadlineAt ? new Date(result.deadlineAt) : null,
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
      const rows = await sql`
        SELECT advance_repository_run(
          ${repositoryIdentity},
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${update.stage},
          ${update.candidateDigest ?? null},
          ${update.outcome ? JSON.stringify(update.outcome) : null}::jsonb,
          ${update.lastErrorCode ?? null}
        ) AS advanced
      `;

      return Boolean((rows[0] as { advanced: boolean } | undefined)?.advanced);
    },
    async finishRepositoryRun(
      signalId,
      repositoryIdentity,
      workflowRunId,
      fencingToken,
      update,
    ) {
      const rows = await sql`
        SELECT finish_repository_run(
          ${repositoryIdentity},
          ${signalId}::uuid,
          ${workflowRunId},
          ${fencingToken}::uuid,
          ${update.stage},
          ${JSON.stringify(update.outcome)}::jsonb,
          ${update.lastErrorCode ?? null}
        ) AS finished
      `;

      return Boolean((rows[0] as { finished: boolean } | undefined)?.finished);
    },
    async cleanupExpiredRecords() {
      const rows = await sql`
        SELECT
          deleted_signals AS "deletedSignals",
          deleted_rate_windows AS "deletedRateWindows"
        FROM cleanup_issue_triage_expired()
      `;
      const result = rows[0] as
        | {
            deletedSignals: string | number;
            deletedRateWindows: string | number;
          }
        | undefined;

      if (!result) {
        throw new Error("Retention cleanup did not return a result");
      }

      return {
        deletedSignals: Number(result.deletedSignals),
        deletedRateWindows: Number(result.deletedRateWindows),
      };
    },
  };
}
