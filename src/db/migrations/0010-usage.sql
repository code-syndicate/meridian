-- Cumulative value moved per user, per window. Written in the same breath as
-- the ledger post so a limit can never drift from the money it governs.
CREATE TABLE usage_counters (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('outbound', 'inbound')),
  window_key  TEXT NOT NULL,
  used_usd    INTEGER NOT NULL DEFAULT 0 CHECK (used_usd >= 0),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, window_key)
) WITHOUT ROWID;

CREATE INDEX idx_usage_user ON usage_counters (user_id, kind);
