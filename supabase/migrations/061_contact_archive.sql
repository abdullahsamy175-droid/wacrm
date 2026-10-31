-- ============================================================
-- Bnerd: archive a contact instead of deleting it (see docs/bnerd.md).
--
-- When a student asks to delete their account the Portal hides them
-- and keeps their data, so wacrm must do the same: the contact leaves
-- every staff screen and can't be messaged, and no row is removed.
--
-- `archived_at` is copied onto conversations and deals so the RLS
-- policies stay a plain column check. Messages, notes and tags need
-- no change: their policies look through the parent row, which RLS
-- now hides. The service role bypasses all of this, so server code
-- still sees archived rows; the public API filters them explicitly.
--
-- Archiving is one-way here: there is no un-archive path, and finding
-- a contact by phone does not clear `archived_at`.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_archived
  ON contacts(account_id) WHERE archived_at IS NOT NULL;

-- A conversation or deal opened after archiving (say, the student
-- writes in again) must stay hidden too.
CREATE OR REPLACE FUNCTION public.inherit_contact_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    SELECT archived_at INTO NEW.archived_at FROM contacts WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inherit_contact_archive ON conversations;
CREATE TRIGGER inherit_contact_archive
  BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.inherit_contact_archive();

DROP TRIGGER IF EXISTS inherit_contact_archive ON deals;
CREATE TRIGGER inherit_contact_archive
  BEFORE INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION public.inherit_contact_archive();

-- Idempotent: archiving twice keeps the first timestamp. Returns the
-- contact's archived_at, or NULL when it isn't in this account.
CREATE OR REPLACE FUNCTION public.archive_contact(
  p_account_id UUID,
  p_contact_id UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_archived_at TIMESTAMPTZ;
BEGIN
  UPDATE contacts
  SET archived_at = COALESCE(archived_at, now())
  WHERE id = p_contact_id AND account_id = p_account_id
  RETURNING archived_at INTO v_archived_at;

  IF v_archived_at IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE conversations SET archived_at = v_archived_at
  WHERE contact_id = p_contact_id AND archived_at IS NULL;

  UPDATE deals SET archived_at = v_archived_at
  WHERE contact_id = p_contact_id AND archived_at IS NULL;

  -- Nothing still in flight may message them.
  UPDATE flow_runs SET status = 'cancelled'
  WHERE contact_id = p_contact_id AND status = 'active';

  RETURN v_archived_at;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_contact(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_contact(UUID, UUID) TO service_role;

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (is_account_member(account_id) AND archived_at IS NULL);

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND archived_at IS NULL);

DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (is_account_member(account_id) AND archived_at IS NULL);
