-- Subsystem D is built, so deposits and withdrawals switch on for the five
-- launch chains. Trading stays off: subsystem E does not exist yet.
UPDATE assets SET deposit_enabled = 1, withdrawal_enabled = 1;
