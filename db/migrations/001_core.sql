CREATE TABLE IF NOT EXISTS issue_signals (
  signal_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  incident_key text NOT NULL UNIQUE,
  policy_version text NOT NULL,
  source text NOT NULL,
  source_account text NOT NULL,
  repository_keys text[] NOT NULL,
  signal jsonb NOT NULL,
  admitted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  workflow_start_claim_id uuid,
  workflow_start_claimed_at timestamptz,
  workflow_run_id text,
  outcomes jsonb,
  initial_notification_claimed_at timestamptz,
  slack_message_ts text,
  notification_claimed_at timestamptz,
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS issue_signals_expires_at_idx
  ON issue_signals (expires_at);

CREATE TABLE IF NOT EXISTS source_rate_windows (
  source text NOT NULL,
  source_account text NOT NULL,
  window_started_at timestamptz NOT NULL,
  accepted_count integer NOT NULL CHECK (accepted_count > 0),
  PRIMARY KEY (source, source_account, window_started_at)
);

CREATE INDEX IF NOT EXISTS source_rate_windows_started_at_idx
  ON source_rate_windows (window_started_at);

CREATE TABLE IF NOT EXISTS repository_run_leases (
  repository_key text PRIMARY KEY,
  signal_id uuid NOT NULL REFERENCES issue_signals(signal_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS repository_run_leases_expires_at_idx
  ON repository_run_leases (expires_at);

CREATE TABLE IF NOT EXISTS pull_request_budget_claims (
  repository_key text NOT NULL,
  signal_id uuid NOT NULL REFERENCES issue_signals(signal_id) ON DELETE CASCADE,
  claim_day date NOT NULL,
  PRIMARY KEY (repository_key, signal_id, claim_day)
);

CREATE INDEX IF NOT EXISTS pull_request_budget_claims_day_idx
  ON pull_request_budget_claims (claim_day);
