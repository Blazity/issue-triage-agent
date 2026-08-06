ALTER TABLE repository_runs
  ADD COLUMN IF NOT EXISTS workflow_run_id text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

ALTER TABLE repository_run_leases_v2
  ADD COLUMN IF NOT EXISTS workflow_run_id text;

CREATE OR REPLACE FUNCTION claim_repository_run_lease_v2(
  p_repository_identity text,
  p_repository_key text,
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_maximum_active_runs integer,
  p_expires_at timestamptz,
  p_deadline_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_token uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('issue-triage-repository-runs', 0)
  );

  UPDATE repository_runs AS run
  SET stage = 'failed',
      last_error_code = 'lease_expired',
      fencing_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE run.stage NOT IN ('completed', 'failed')
    AND run.lease_expires_at <= now();

  DELETE FROM repository_run_leases_v2 WHERE expires_at <= now();

  SELECT fencing_token
  INTO v_existing_token
  FROM repository_run_leases_v2
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id;

  IF v_existing_token IS NOT NULL THEN
    RETURN v_existing_token;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM repository_run_leases_v2
    WHERE repository_identity = p_repository_identity
  ) OR (
    SELECT count(*) FROM repository_run_leases_v2
  ) >= p_maximum_active_runs THEN
    RETURN NULL;
  END IF;

  INSERT INTO repository_run_leases_v2 (
    repository_identity,
    signal_id,
    workflow_run_id,
    fencing_token,
    expires_at
  ) VALUES (
    p_repository_identity,
    p_signal_id,
    p_workflow_run_id,
    p_fencing_token,
    p_expires_at
  );

  INSERT INTO repository_runs (
    signal_id,
    repository_identity,
    repository_key,
    workflow_run_id,
    stage,
    fencing_token,
    lease_expires_at,
    started_at,
    deadline_at,
    updated_at
  ) VALUES (
    p_signal_id,
    p_repository_identity,
    p_repository_key,
    p_workflow_run_id,
    'claimed',
    p_fencing_token,
    p_expires_at,
    now(),
    p_deadline_at,
    now()
  )
  ON CONFLICT (signal_id, repository_identity)
  DO UPDATE SET
    repository_key = EXCLUDED.repository_key,
    workflow_run_id = EXCLUDED.workflow_run_id,
    stage = CASE
      WHEN repository_runs.stage IN ('completed', 'failed')
        THEN repository_runs.stage
      ELSE EXCLUDED.stage
    END,
    fencing_token = EXCLUDED.fencing_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    deadline_at = EXCLUDED.deadline_at,
    updated_at = now();

  RETURN p_fencing_token;
END;
$$;

CREATE OR REPLACE FUNCTION renew_repository_run_lease_v2(
  p_repository_identity text,
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE repository_run_leases_v2
  SET expires_at = p_expires_at
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id
    AND fencing_token = p_fencing_token
    AND expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE repository_runs
    SET lease_expires_at = p_expires_at, updated_at = now()
    WHERE repository_identity = p_repository_identity
      AND signal_id = p_signal_id
      AND workflow_run_id = p_workflow_run_id
      AND fencing_token = p_fencing_token;
  END IF;

  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION advance_repository_run(
  p_repository_identity text,
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_stage text,
  p_candidate_digest text,
  p_outcome jsonb,
  p_last_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE repository_runs
  SET stage = p_stage,
      candidate_digest = COALESCE(p_candidate_digest, candidate_digest),
      outcome = COALESCE(p_outcome, outcome),
      last_error_code = p_last_error_code,
      updated_at = now()
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id
    AND fencing_token = p_fencing_token
    AND lease_expires_at > now()
    AND deadline_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION release_repository_run_lease_v2(
  p_repository_identity text,
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM repository_run_leases_v2
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id
    AND fencing_token = p_fencing_token;

  UPDATE repository_runs
  SET fencing_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id
    AND fencing_token = p_fencing_token;
END;
$$;
