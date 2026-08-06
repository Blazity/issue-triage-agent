CREATE OR REPLACE FUNCTION finish_repository_run(
  p_repository_identity text,
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_stage text,
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
      outcome = p_outcome,
      last_error_code = p_last_error_code,
      fencing_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE repository_identity = p_repository_identity
    AND signal_id = p_signal_id
    AND workflow_run_id = p_workflow_run_id
    AND fencing_token = p_fencing_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    DELETE FROM repository_run_leases_v2
    WHERE repository_identity = p_repository_identity
      AND signal_id = p_signal_id
      AND workflow_run_id = p_workflow_run_id
      AND fencing_token = p_fencing_token;
  END IF;

  RETURN v_updated = 1;
END;
$$;
