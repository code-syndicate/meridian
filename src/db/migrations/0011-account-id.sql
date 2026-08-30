-- A public account identifier, so a transfer can be addressed without
-- disclosing an email address. Distinct from users.id, which is a database
-- key and must not leak into anything a user can share.
ALTER TABLE users ADD COLUMN account_id TEXT;

-- Existing rows get one from randomblob. Hex is a subset of the alphabet the
-- application generates from, so these are valid ids, just less varied.
UPDATE users SET account_id = UPPER(HEX(RANDOMBLOB(5))) WHERE account_id IS NULL;

CREATE UNIQUE INDEX idx_users_account_id ON users (account_id);
