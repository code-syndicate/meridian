-- Operator access. Separate from status so suspending an admin does not also
-- demote them, and so a role change is one column to audit.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
CREATE INDEX idx_users_role ON users (role) WHERE role <> 'user';

-- Withdrawals now wait for approval before they are submitted. The limit
-- headroom reserved at request time is recorded so a rejection can give
-- exactly that back, rather than re-pricing at a different moment.
ALTER TABLE withdrawals ADD COLUMN limit_window TEXT;
ALTER TABLE withdrawals ADD COLUMN limit_usd INTEGER;
ALTER TABLE withdrawals ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE withdrawals ADD COLUMN reviewed_at TEXT;
ALTER TABLE withdrawals ADD COLUMN review_note TEXT;

CREATE INDEX idx_withdrawals_queue ON withdrawals(status) WHERE status = 'requested';
