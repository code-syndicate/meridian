CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  asset       TEXT NOT NULL REFERENCES assets(symbol),
  type        TEXT NOT NULL CHECK (type IN (
                'user_available', 'user_hold',
                'platform_fee', 'platform_treasury', 'platform_dust',
                'external_deposit', 'external_withdrawal'
              )),
  created_at  TEXT NOT NULL,
  CHECK ((user_id IS NOT NULL) = (type IN ('user_available', 'user_hold')))
);

CREATE UNIQUE INDEX idx_accounts_user ON accounts(user_id, asset, type)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_accounts_platform ON accounts(asset, type)
  WHERE user_id IS NULL;

CREATE TABLE ledger_transactions (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  external_ref     TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  id              INTEGER PRIMARY KEY,
  transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  asset           TEXT NOT NULL REFERENCES assets(symbol),
  amount          INTEGER NOT NULL CHECK (amount <> 0),
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_entries_account ON ledger_entries(account_id, id);
CREATE INDEX idx_entries_tx ON ledger_entries(transaction_id);

CREATE TABLE account_balances (
  account_id     INTEGER PRIMARY KEY REFERENCES accounts(id),
  amount         INTEGER NOT NULL DEFAULT 0,
  last_entry_id  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE TABLE holds (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  asset                 TEXT NOT NULL REFERENCES assets(symbol),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
  reference             TEXT NOT NULL,
  place_transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  close_transaction_id  INTEGER REFERENCES ledger_transactions(id),
  created_at            TEXT NOT NULL,
  closed_at             TEXT,
  CHECK ((status = 'active') = (close_transaction_id IS NULL))
);

CREATE INDEX idx_holds_user_active ON holds(user_id, asset) WHERE status = 'active';

CREATE TRIGGER ledger_transactions_no_update BEFORE UPDATE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;

CREATE TRIGGER ledger_transactions_no_delete BEFORE DELETE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;

CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;

CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
