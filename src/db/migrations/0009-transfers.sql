-- Intra-platform transfers. Instant, off-chain, no network fee: both sides
-- are accounts on this ledger, so nothing touches a blockchain.
CREATE TABLE transfers (
  id               INTEGER PRIMARY KEY,
  sender_id        INTEGER NOT NULL REFERENCES users(id),
  recipient_id     INTEGER NOT NULL REFERENCES users(id),
  asset            TEXT NOT NULL REFERENCES assets(symbol),
  amount           INTEGER NOT NULL CHECK (amount > 0),
  note             TEXT,
  ledger_tx_id     INTEGER NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL,
  -- Sending to yourself is a no-op that would still write a journal entry.
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX idx_transfers_sender ON transfers(sender_id, id);
CREATE INDEX idx_transfers_recipient ON transfers(recipient_id, id);
