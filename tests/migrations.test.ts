import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { applyMigrations, loadMigrations } from "../src/migrations";

test("migrations are append-only and admission replaces expired fingerprints", async () => {
  const database = new PGlite();
  const migrations = await loadMigrations(
    new URL("../db/migrations/", import.meta.url),
  );

  expect(migrations.map(({ name }) => name)).toEqual([
    "001_core.sql",
    "002_durable_runs.sql",
    "003_fenced_repository_runs.sql",
    "004_repository_run_ownership.sql",
    "005_finish_repository_runs.sql",
    "006_recover_expired_repository_runs.sql",
    "007_incident_run_ownership.sql",
    "008_incident_recovery_schedule.sql",
  ]);

  await applyMigrations(database, migrations);
  await applyMigrations(database, migrations);

  const firstSignalId = randomUUID();
  const first = await admit(database, {
    signalId: firstSignalId,
    admittedAt: "2026-08-07T10:00:00.000Z",
    expiresAt: "2026-08-14T10:00:00.000Z",
  });
  const duplicate = await admit(database, {
    signalId: randomUUID(),
    admittedAt: "2026-08-07T10:01:00.000Z",
    expiresAt: "2026-08-14T10:01:00.000Z",
  });

  expect(first.rows[0]).toMatchObject({
    status: "accepted",
    signalId: firstSignalId,
  });
  expect(duplicate.rows[0]).toMatchObject({
    status: "duplicate",
    signalId: firstSignalId,
  });

  await database.query(
    "UPDATE issue_signals SET expires_at = '2026-08-07T09:00:00.000Z' WHERE signal_id = $1",
    [firstSignalId],
  );
  const replacementSignalId = randomUUID();
  const replacement = await admit(database, {
    signalId: replacementSignalId,
    admittedAt: "2026-08-07T11:00:00.000Z",
    expiresAt: "2026-08-14T11:00:00.000Z",
  });

  expect(replacement.rows[0]).toMatchObject({
    status: "accepted",
    signalId: replacementSignalId,
  });

  const fencingToken = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const claimed = await database.query<{ fencingToken: string | null }>(
    `SELECT claim_repository_run_lease_v2($1, $2, $3, $4, $5, $6, $7, $8) AS "fencingToken"`,
    [
      "201:101",
      "storefront",
      replacementSignalId,
      "workflow-1",
      fencingToken,
      3,
      expiresAt,
      expiresAt,
    ],
  );
  const competing = await database.query<{ fencingToken: string | null }>(
    `SELECT claim_repository_run_lease_v2($1, $2, $3, $4, $5, $6, $7, $8) AS "fencingToken"`,
    [
      "201:101",
      "storefront-alias",
      replacementSignalId,
      "workflow-2",
      randomUUID(),
      3,
      expiresAt,
      expiresAt,
    ],
  );

  expect(claimed.rows[0]?.fencingToken).toBe(fencingToken);
  expect(competing.rows[0]?.fencingToken).toBeNull();

  await database.query(
    `UPDATE repository_run_leases_v2 SET expires_at = now() - interval '1 second'
     WHERE repository_identity = $1`,
    ["201:101"],
  );
  await database.query(
    `UPDATE repository_runs SET lease_expires_at = now() - interval '1 second'
     WHERE signal_id = $1 AND repository_identity = $2`,
    [replacementSignalId, "201:101"],
  );
  const recoveryToken = randomUUID();
  const recovered = await database.query<{ fencingToken: string | null }>(
    `SELECT claim_repository_run_lease_v2($1, $2, $3, $4, $5, $6, $7, $8) AS "fencingToken"`,
    [
      "201:101",
      "storefront",
      replacementSignalId,
      "workflow-2",
      recoveryToken,
      3,
      expiresAt,
      expiresAt,
    ],
  );

  expect(recovered.rows[0]?.fencingToken).toBe(recoveryToken);

  const incidentToken = randomUUID();
  const incidentDeadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const incidentOwner = await claimIncidentRun(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-2",
    fencingToken: incidentToken,
    deadlineAt: incidentDeadline,
  });
  const competingIncidentOwner = await claimIncidentRun(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-3",
    fencingToken: randomUUID(),
    deadlineAt: incidentDeadline,
  });

  expect(incidentOwner.rows[0]).toEqual({
    status: "claimed",
    fencingToken: incidentToken,
    retryAt: null,
  });
  expect(competingIncidentOwner.rows[0]).toMatchObject({
    status: "owned",
    fencingToken: null,
  });
  expect(competingIncidentOwner.rows[0]?.retryAt).not.toBeNull();

  await database.query(
    "UPDATE issue_signals SET incident_lease_expires_at = now() - interval '1 second' WHERE signal_id = $1",
    [replacementSignalId],
  );
  const takeoverToken = randomUUID();
  const takeover = await claimIncidentRun(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-3",
    fencingToken: takeoverToken,
    deadlineAt: incidentDeadline,
  });

  expect(takeover.rows[0]).toEqual({
    status: "claimed",
    fencingToken: takeoverToken,
    retryAt: null,
  });

  const staleSave = await saveIncidentOutcomes(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-2",
    fencingToken: incidentToken,
  });
  const ownerSave = await saveIncidentOutcomes(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-3",
    fencingToken: takeoverToken,
  });

  expect(staleSave.rows[0]?.saved).toBe(false);
  expect(ownerSave.rows[0]?.saved).toBe(true);

  const idempotentSave = await saveIncidentOutcomes(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-3",
    fencingToken: takeoverToken,
  });
  const completedClaim = await claimIncidentRun(database, {
    signalId: replacementSignalId,
    workflowRunId: "workflow-4",
    fencingToken: randomUUID(),
    deadlineAt: incidentDeadline,
  });

  expect(idempotentSave.rows[0]?.saved).toBe(true);
  expect(completedClaim.rows[0]).toEqual({
    status: "completed",
    fencingToken: null,
    retryAt: null,
  });

  await database.query(
    "UPDATE issue_signals SET expires_at = now() - interval '1 second' WHERE signal_id = $1",
    [replacementSignalId],
  );
  const cleanup = await database.query<{ deletedSignals: number }>(
    `SELECT deleted_signals AS "deletedSignals" FROM cleanup_issue_triage_expired()`,
  );
  const retained = await database.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM issue_signals WHERE signal_id = $1",
    [replacementSignalId],
  );

  expect(cleanup.rows[0]?.deletedSignals).toBe(1);
  expect(retained.rows[0]?.count).toBe(0);

  await database.close();
});

function admit(
  database: PGlite,
  input: { signalId: string; admittedAt: string; expiresAt: string },
) {
  return database.query<{ status: string; signalId: string; reason: string }>(
    `SELECT status, signal_id AS "signalId", reason
     FROM admit_issue_signal($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.signalId,
      "delivery-key",
      "incident-key",
      "1",
      "webhook",
      "acme",
      ["storefront"],
      JSON.stringify({ title: "Checkout is failing" }),
      input.admittedAt,
      input.expiresAt,
      60,
    ],
  );
}

function claimIncidentRun(
  database: PGlite,
  input: {
    signalId: string;
    workflowRunId: string;
    fencingToken: string;
    deadlineAt: string;
  },
) {
  return database.query<{
    status: string;
    fencingToken: string | null;
    retryAt: Date | null;
  }>(
    `SELECT status, fencing_token AS "fencingToken", retry_at AS "retryAt"
     FROM claim_incident_run($1, $2, $3, $4)`,
    [input.signalId, input.workflowRunId, input.fencingToken, input.deadlineAt],
  );
}

function saveIncidentOutcomes(
  database: PGlite,
  input: { signalId: string; workflowRunId: string; fencingToken: string },
) {
  return database.query<{ saved: boolean }>(
    `SELECT save_incident_outcomes($1, $2, $3, $4::jsonb) AS saved`,
    [
      input.signalId,
      input.workflowRunId,
      input.fencingToken,
      JSON.stringify([{ repositoryKey: "storefront", status: "notified" }]),
    ],
  );
}
