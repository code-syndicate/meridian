CREATE TABLE kyc_applications (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL
                      CHECK (status IN ('draft','submitted','in_review','approved','rejected','expired')),
  current_step      TEXT NOT NULL
                      CHECK (current_step IN ('identity','government_id','address','document','disclosures','done')),
  target_tier       INTEGER NOT NULL CHECK (target_tier IN (1, 2)),
  provider          TEXT,
  provider_ref      TEXT,
  document_session  TEXT,
  rejection_reason  TEXT,
  submitted_at      TEXT,
  decided_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- One open application per user. A rejected or expired one may be replaced.
CREATE UNIQUE INDEX idx_kyc_open_per_user ON kyc_applications(user_id)
  WHERE status IN ('draft', 'submitted', 'in_review', 'approved');

CREATE TABLE kyc_profiles (
  application_id       INTEGER PRIMARY KEY REFERENCES kyc_applications(id),
  first_name           TEXT,
  middle_name          TEXT,
  last_name            TEXT,
  date_of_birth        TEXT,
  phone                TEXT,
  phone_verified_at    TEXT,
  government_id_type   TEXT CHECK (government_id_type IN ('BVN', 'NIN')),
  government_id_last4  TEXT CHECK (government_id_last4 IS NULL OR length(government_id_last4) = 4),
  provider_reference   TEXT,
  state                TEXT,
  lga                  TEXT,
  street_address       TEXT,
  postal_code          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE kyc_consents (
  id              INTEGER PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES kyc_applications(id),
  document        TEXT NOT NULL CHECK (document IN ('terms','privacy','risk','aml')),
  version         TEXT NOT NULL,
  ip              TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_kyc_consents_application ON kyc_consents(application_id);

CREATE TRIGGER kyc_consents_no_update BEFORE UPDATE ON kyc_consents
BEGIN SELECT RAISE(ABORT, 'kyc_consents is append-only'); END;

CREATE TRIGGER kyc_consents_no_delete BEFORE DELETE ON kyc_consents
BEGIN SELECT RAISE(ABORT, 'kyc_consents is append-only'); END;
