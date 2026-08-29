CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  ip             TEXT,
  user_agent     TEXT,
  revoked_at     TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  action       TEXT NOT NULL,
  target       TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_audit_user ON audit_log(user_id, id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,
  tokens       REAL NOT NULL,
  updated_at   TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE recovery_codes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_recovery_user ON recovery_codes(user_id) WHERE used_at IS NULL;
