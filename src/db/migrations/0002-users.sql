CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  email_normalized      TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  email_verified_at     TEXT,
  totp_secret_encrypted TEXT,
  totp_enabled_at       TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'closed')),
  kyc_tier              INTEGER NOT NULL DEFAULT 0 CHECK (kyc_tier BETWEEN 0 AND 2),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
