ALTER TABLE issue_signals
  ADD COLUMN IF NOT EXISTS incident_workflow_run_id text,
  ADD COLUMN IF NOT EXISTS incident_fencing_token uuid,
  ADD COLUMN IF NOT EXISTS incident_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS issue_signals_incident_lease_expires_at_idx
  ON issue_signals (incident_lease_expires_at)
  WHERE incident_lease_expires_at IS NOT NULL AND outcomes IS NULL;

CREATE OR REPLACE FUNCTION claim_incident_run(
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_lease_expires_at timestamptz
)
RETURNS TABLE(status text, fencing_token uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_signal issue_signals%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('incident:' || p_signal_id::text, 0));

  SELECT *
  INTO v_signal
  FROM issue_signals
  WHERE signal_id = p_signal_id
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Issue Signal not found: %', p_signal_id;
  END IF;

  IF v_signal.outcomes IS NOT NULL THEN
    RETURN QUERY SELECT 'completed'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_signal.incident_workflow_run_id = p_workflow_run_id
    AND v_signal.incident_lease_expires_at > now()
  THEN
    RETURN QUERY
      SELECT 'claimed'::text, v_signal.incident_fencing_token;
    RETURN;
  END IF;

  IF v_signal.incident_workflow_run_id IS NOT NULL
    AND v_signal.incident_lease_expires_at > now()
  THEN
    RETURN QUERY SELECT 'owned'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE issue_signals
  SET incident_workflow_run_id = p_workflow_run_id,
      incident_fencing_token = p_fencing_token,
      incident_lease_expires_at = p_lease_expires_at
  WHERE signal_id = p_signal_id;

  RETURN QUERY SELECT 'claimed'::text, p_fencing_token;
END;
$$;

CREATE OR REPLACE FUNCTION save_incident_outcomes(
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_outcomes jsonb
)
RETURNS boolean
LANGUAGE sql
AS $$
  WITH saved AS (
    UPDATE issue_signals
    SET outcomes = p_outcomes
    WHERE signal_id = p_signal_id
      AND (outcomes IS NULL OR outcomes = p_outcomes)
      AND incident_workflow_run_id = p_workflow_run_id
      AND incident_fencing_token = p_fencing_token
      AND incident_lease_expires_at > now()
    RETURNING signal_id
  )
  SELECT EXISTS (SELECT 1 FROM saved);
$$;
