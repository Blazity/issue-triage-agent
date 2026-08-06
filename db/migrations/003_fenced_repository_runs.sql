CREATE OR REPLACE FUNCTION claim_repository_run_lease(
  p_repository_identity text,
  p_repository_key text,
  p_signal_id uuid,
  p_fencing_token uuid,
  p_maximum_active_runs integer,
  p_expires_at timestamptz
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
    AND signal_id = p_signal_id;

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
    fencing_token,
    expires_at
  ) VALUES (
    p_repository_identity,
    p_signal_id,
    p_fencing_token,
    p_expires_at
  );

  INSERT INTO repository_runs (
    signal_id,
    repository_identity,
    repository_key,
    stage,
    fencing_token,
    lease_expires_at,
    updated_at
  ) VALUES (
    p_signal_id,
    p_repository_identity,
    p_repository_key,
    'claimed',
    p_fencing_token,
    p_expires_at,
    now()
  )
  ON CONFLICT (signal_id, repository_identity)
  DO UPDATE SET
    fencing_token = EXCLUDED.fencing_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    updated_at = now();

  RETURN p_fencing_token;
END;
$$;

CREATE OR REPLACE FUNCTION renew_repository_run_lease(
  p_repository_identity text,
  p_signal_id uuid,
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
    AND fencing_token = p_fencing_token
    AND expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE repository_runs
    SET lease_expires_at = p_expires_at, updated_at = now()
    WHERE repository_identity = p_repository_identity
      AND signal_id = p_signal_id
      AND fencing_token = p_fencing_token;
  END IF;

  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION release_repository_run_lease(
  p_repository_identity text,
  p_signal_id uuid,
  p_fencing_token uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM repository_run_leases_v2
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND fencing_token = p_fencing_token;

  UPDATE repository_runs
  SET fencing_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND fencing_token = p_fencing_token;
END;
$$;
