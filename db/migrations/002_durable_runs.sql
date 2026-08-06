CREATE TABLE IF NOT EXISTS repository_runs (
  signal_id uuid NOT NULL REFERENCES issue_signals(signal_id) ON DELETE CASCADE,
  repository_identity text NOT NULL,
  repository_key text NOT NULL,
  stage text NOT NULL DEFAULT 'pending',
  fencing_token uuid,
  lease_expires_at timestamptz,
  base_sha text,
  candidate_digest text,
  expected_tree_sha text,
  outcome jsonb,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, repository_identity)
);

CREATE UNIQUE INDEX IF NOT EXISTS repository_runs_active_repository_idx
  ON repository_runs (repository_identity)
  WHERE stage NOT IN ('completed', 'failed');

CREATE INDEX IF NOT EXISTS repository_runs_lease_expires_at_idx
  ON repository_runs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS repository_run_leases_v2 (
  repository_identity text PRIMARY KEY,
  signal_id uuid NOT NULL REFERENCES issue_signals(signal_id) ON DELETE CASCADE,
  fencing_token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS repository_run_leases_v2_expires_at_idx
  ON repository_run_leases_v2 (expires_at);

CREATE TABLE IF NOT EXISTS pull_request_budget_claims_v2 (
  repository_identity text NOT NULL,
  signal_id uuid NOT NULL REFERENCES issue_signals(signal_id) ON DELETE CASCADE,
  claim_day date NOT NULL,
  PRIMARY KEY (repository_identity, signal_id, claim_day)
);

CREATE INDEX IF NOT EXISTS pull_request_budget_claims_v2_day_idx
  ON pull_request_budget_claims_v2 (claim_day);

CREATE OR REPLACE FUNCTION admit_issue_signal(
  p_signal_id uuid,
  p_idempotency_key text,
  p_incident_key text,
  p_policy_version text,
  p_source text,
  p_source_account text,
  p_repository_keys text[],
  p_signal jsonb,
  p_admitted_at timestamptz,
  p_expires_at timestamptz,
  p_source_events_per_minute integer
)
RETURNS TABLE(status text, signal_id uuid, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_signal_id uuid;
  v_rate_count integer;
  v_window timestamptz := date_trunc('minute', p_admitted_at);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0))
  FROM unnest(ARRAY[
    'delivery:' || p_idempotency_key,
    'incident:' || p_incident_key,
    'rate:' || p_source || ':' || p_source_account || ':' || v_window::text
  ]) AS lock_key
  ORDER BY lock_key;

  DELETE FROM issue_signals
  WHERE expires_at <= p_admitted_at
    AND (idempotency_key = p_idempotency_key OR incident_key = p_incident_key);

  SELECT stored.signal_id
  INTO v_existing_signal_id
  FROM issue_signals AS stored
  WHERE stored.expires_at > p_admitted_at
    AND (
      stored.idempotency_key = p_idempotency_key
      OR stored.incident_key = p_incident_key
    )
  LIMIT 1;

  IF v_existing_signal_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_existing_signal_id, NULL::text;
    RETURN;
  END IF;

  INSERT INTO source_rate_windows (
    source,
    source_account,
    window_started_at,
    accepted_count
  )
  VALUES (p_source, p_source_account, v_window, 1)
  ON CONFLICT (source, source_account, window_started_at)
  DO UPDATE SET accepted_count = source_rate_windows.accepted_count + 1
  WHERE source_rate_windows.accepted_count < p_source_events_per_minute
  RETURNING accepted_count INTO v_rate_count;

  IF v_rate_count IS NULL THEN
    RETURN QUERY SELECT 'suppressed'::text, NULL::uuid, 'source_rate_limit'::text;
    RETURN;
  END IF;

  INSERT INTO issue_signals (
    signal_id,
    idempotency_key,
    incident_key,
    policy_version,
    source,
    source_account,
    repository_keys,
    signal,
    admitted_at,
    expires_at
  )
  VALUES (
    p_signal_id,
    p_idempotency_key,
    p_incident_key,
    p_policy_version,
    p_source,
    p_source_account,
    p_repository_keys,
    p_signal,
    p_admitted_at,
    p_expires_at
  );

  RETURN QUERY SELECT 'accepted'::text, p_signal_id, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_issue_triage_expired()
RETURNS TABLE(deleted_signals bigint, deleted_rate_windows bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_signals bigint;
  v_deleted_rate_windows bigint;
BEGIN
  DELETE FROM issue_signals WHERE expires_at <= now();
  GET DIAGNOSTICS v_deleted_signals = ROW_COUNT;

  DELETE FROM source_rate_windows
  WHERE window_started_at < now() - interval '2 days';
  GET DIAGNOSTICS v_deleted_rate_windows = ROW_COUNT;

  DELETE FROM pull_request_budget_claims_v2
  WHERE claim_day < current_date - 7;

  DELETE FROM repository_run_leases_v2 WHERE expires_at <= now();

  RETURN QUERY SELECT v_deleted_signals, v_deleted_rate_windows;
END;
$$;
