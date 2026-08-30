-- Meridian is not a single-market product. Government identifiers, phone
-- numbers, and addresses are no longer Nigeria-shaped.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt.

CREATE TABLE kyc_profiles_new (
  application_id       INTEGER PRIMARY KEY REFERENCES kyc_applications(id),
  first_name           TEXT,
  middle_name          TEXT,
  last_name            TEXT,
  date_of_birth        TEXT,
  phone                TEXT,
  phone_verified_at    TEXT,
  government_id_type   TEXT CHECK (government_id_type IN ('PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE')),
  government_id_last4  TEXT CHECK (government_id_last4 IS NULL OR length(government_id_last4) = 4),
  provider_reference   TEXT,
  country              TEXT,
  region               TEXT,
  city                 TEXT,
  street_address       TEXT,
  postal_code          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

INSERT INTO kyc_profiles_new
  (application_id, first_name, middle_name, last_name, date_of_birth, phone,
   phone_verified_at, government_id_last4, provider_reference, region,
   street_address, postal_code, created_at, updated_at)
SELECT application_id, first_name, middle_name, last_name, date_of_birth, phone,
       phone_verified_at, government_id_last4, provider_reference, state,
       street_address, postal_code, created_at, updated_at
FROM kyc_profiles;

DROP TABLE kyc_profiles;
ALTER TABLE kyc_profiles_new RENAME TO kyc_profiles;
