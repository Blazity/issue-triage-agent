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

  IF EXISTS (
    SELECT 1
    FROM repository_runs
    WHERE signal_id = p_signal_id
      AND repository_identity = p_repository_identity
      AND stage IN ('completed', 'failed')
      AND outcome IS NOT NULL
  ) THEN
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
    stage = 'claimed',
    fencing_token = EXCLUDED.fencing_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    candidate_digest = NULL,
    outcome = NULL,
    last_error_code = NULL,
    started_at = now(),
    deadline_at = EXCLUDED.deadline_at,
    updated_at = now();

  RETURN p_fencing_token;
END;
$$;
