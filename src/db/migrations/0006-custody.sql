-- Subsystem D: custody. Deposit addresses, inbound deposits, outbound
-- withdrawals, and the dust that 8-decimal internal precision leaves behind.

CREATE TABLE deposit_addresses (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  asset        TEXT NOT NULL REFERENCES assets(symbol),
  address      TEXT NOT NULL,
  memo         TEXT,
  provider     TEXT NOT NULL,
  provider_ref TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, asset)
);

CREATE INDEX idx_deposit_addresses_lookup ON deposit_addresses(asset, address);

CREATE TABLE deposits (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  asset             TEXT NOT NULL REFERENCES assets(symbol),
  address           TEXT NOT NULL,
  tx_hash           TEXT NOT NULL,
  output_index      INTEGER NOT NULL DEFAULT 0,
  native_amount     TEXT NOT NULL,
  credited_amount   INTEGER NOT NULL DEFAULT 0,
  dust_amount       TEXT NOT NULL DEFAULT '0',
  confirmations     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL
                      CHECK (status IN ('detected','confirming','credited','rejected')),
  ledger_tx_id      INTEGER REFERENCES ledger_transactions(id),
  first_seen_at     TEXT NOT NULL,
  credited_at       TEXT,
  updated_at        TEXT NOT NULL,
  -- One chain output is one deposit, forever. This is what makes replayed
  -- chain callbacks harmless.
  UNIQUE (asset, tx_hash, output_index)
);

CREATE INDEX idx_deposits_user ON deposits(user_id, id);
CREATE INDEX idx_deposits_pending ON deposits(status) WHERE status IN ('detected','confirming');

CREATE TABLE withdrawals (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  asset             TEXT NOT NULL REFERENCES assets(symbol),
  destination       TEXT NOT NULL,
  memo              TEXT,
  amount            INTEGER NOT NULL CHECK (amount > 0),
  fee               INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status            TEXT NOT NULL
                      CHECK (status IN ('requested','signing','broadcast','confirmed','failed','cancelled')),
  hold_id           INTEGER REFERENCES holds(id),
  provider          TEXT,
  provider_ref      TEXT,
  tx_hash           TEXT,
  failure_reason    TEXT,
  idempotency_key   TEXT NOT NULL UNIQUE,
  requested_at      TEXT NOT NULL,
  settled_at        TEXT,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, id);

-- Truncation remainder. Never discarded: silently keeping a user's dust is
-- theft regardless of magnitude.
CREATE TABLE dust_remainders (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  asset        TEXT NOT NULL REFERENCES assets(symbol),
  native_dust  TEXT NOT NULL DEFAULT '0',
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, asset)
);

-- Confirmed on-chain reserves per asset, written by the custody reconciler.
-- Ledger invariant 5 checks user balances never exceed this.
CREATE TABLE reserves (
  asset       TEXT PRIMARY KEY REFERENCES assets(symbol),
  confirmed   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
