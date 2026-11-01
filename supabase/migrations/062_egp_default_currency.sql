-- ============================================================
-- Bnerd: Egyptian pounds by default (see docs/bnerd.md).
--
-- New accounts start on EGP, and so does any deal inserted without a
-- currency. Accounts that already exist keep the currency they chose,
-- and existing deals keep their saved one.
-- ============================================================

ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'EGP';
ALTER TABLE deals ALTER COLUMN currency SET DEFAULT 'EGP';
