DROP FUNCTION claim_incident_run(uuid, text, uuid, timestamptz);

CREATE FUNCTION claim_incident_run(
  p_signal_id uuid,
  p_workflow_run_id text,
  p_fencing_token uuid,
  p_lease_expires_at timestamptz
)
RETURNS TABLE(status text, fencing_token uuid, retry_at timestamptz)
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
    RETURN QUERY SELECT 'completed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_signal.incident_workflow_run_id = p_workflow_run_id
    AND v_signal.incident_lease_expires_at > now()
  THEN
    RETURN QUERY
      SELECT 'claimed'::text, v_signal.incident_fencing_token, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_signal.incident_workflow_run_id IS NOT NULL
    AND v_signal.incident_lease_expires_at > now()
  THEN
    RETURN QUERY
      SELECT 'owned'::text, NULL::uuid, v_signal.incident_lease_expires_at;
    RETURN;
  END IF;

  UPDATE issue_signals
  SET incident_workflow_run_id = p_workflow_run_id,
      incident_fencing_token = p_fencing_token,
      incident_lease_expires_at = p_lease_expires_at
  WHERE signal_id = p_signal_id;

  RETURN QUERY SELECT 'claimed'::text, p_fencing_token, NULL::timestamptz;
END;
$$;
