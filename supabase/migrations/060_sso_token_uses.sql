-- ============================================================
-- Bnerd: single sign-on from the staff Portal (see docs/bnerd.md).
--
-- Each sign-in token carries a unique `jti`. Recording it here makes
-- a token single-use: the primary key turns a replay into a unique
-- violation. Rows are only needed until the token would have expired
-- anyway, so /api/sso clears old ones as it goes.
--
-- RLS is on with no policies: only the service role touches this.
-- ============================================================

CREATE TABLE IF NOT EXISTS sso_token_uses (
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sso_token_uses_expires
  ON sso_token_uses(expires_at);

ALTER TABLE sso_token_uses ENABLE ROW LEVEL SECURITY;
