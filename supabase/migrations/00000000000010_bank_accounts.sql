-- bank_accounts: supports both banks (entity_type='bank') and orgs (entity_type='organization')
CREATE TABLE bank_accounts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type          TEXT        NOT NULL CHECK (entity_type IN ('bank', 'organization')),
  entity_id            UUID        NOT NULL,
  nickname             TEXT        NOT NULL DEFAULT '',
  bank_name            TEXT        NOT NULL DEFAULT '',
  account_holder_name  TEXT        NOT NULL DEFAULT '',
  account_number       TEXT        NOT NULL DEFAULT '',
  routing_number       TEXT        NOT NULL DEFAULT '',
  swift_iban           TEXT,
  account_type         TEXT        NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking', 'savings')),
  is_primary           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bank_accounts_entity_idx ON bank_accounts (entity_type, entity_id);

CREATE OR REPLACE FUNCTION update_bank_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_bank_accounts_updated_at();

-- RLS
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- org_admin / org_member: read own org's accounts
CREATE POLICY "org_members_read_bank_accounts"
  ON bank_accounts FOR SELECT
  USING (
    entity_type = 'organization'
    AND entity_id IN (
      SELECT org_id FROM users WHERE id = auth.uid() AND org_id IS NOT NULL
    )
  );

-- org_admin only: insert/update/delete own org accounts
CREATE POLICY "org_admin_write_bank_accounts"
  ON bank_accounts FOR ALL
  USING (
    entity_type = 'organization'
    AND entity_id IN (
      SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('org_admin') AND org_id IS NOT NULL
    )
  )
  WITH CHECK (
    entity_type = 'organization'
    AND entity_id IN (
      SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('org_admin') AND org_id IS NOT NULL
    )
  );

-- bank_admin / bank_credit_officer: read own bank's accounts
CREATE POLICY "bank_users_read_bank_accounts"
  ON bank_accounts FOR SELECT
  USING (
    entity_type = 'bank'
    AND entity_id IN (
      SELECT bank_id FROM users WHERE id = auth.uid() AND bank_id IS NOT NULL
    )
  );

-- bank_admin only: insert/update/delete own bank accounts
CREATE POLICY "bank_admin_write_bank_accounts"
  ON bank_accounts FOR ALL
  USING (
    entity_type = 'bank'
    AND entity_id IN (
      SELECT bank_id FROM users WHERE id = auth.uid() AND role = 'bank_admin' AND bank_id IS NOT NULL
    )
  )
  WITH CHECK (
    entity_type = 'bank'
    AND entity_id IN (
      SELECT bank_id FROM users WHERE id = auth.uid() AND role = 'bank_admin' AND bank_id IS NOT NULL
    )
  );

-- strike_admin: full read access
CREATE POLICY "strike_admin_read_bank_accounts"
  ON bank_accounts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'strike_admin')
  );
