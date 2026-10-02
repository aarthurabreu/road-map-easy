CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_generation
ON auth_sessions (user_id, generation);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS invite_email_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL,
  recipient_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_attempts_owner_created
ON invite_email_attempts (owner_key, created_at);

CREATE INDEX IF NOT EXISTS idx_invite_attempts_recipient_created
ON invite_email_attempts (recipient_key, created_at);

CREATE INDEX IF NOT EXISTS idx_invite_attempts_pair_created
ON invite_email_attempts (owner_key, recipient_key, created_at);

CREATE INDEX IF NOT EXISTS idx_invite_attempts_created
ON invite_email_attempts (created_at);
