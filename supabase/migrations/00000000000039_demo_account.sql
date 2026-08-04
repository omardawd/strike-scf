-- Tracks per-user demo-mode playback state for the dedicated demo@demo.com
-- account (see apps/web/lib/demo.ts). Gating itself is an email check in app
-- code, not RLS-driven — this table only records "has the intro cinematic
-- played" and "when was the sandbox data last reset" so the demo experience
-- doesn't replay the full intro on every login and so sales reps can reset
-- the sandbox between client viewings.
CREATE TABLE demo_account_state (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  intro_played_at  TIMESTAMPTZ,
  last_reset_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_demo_account_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER demo_account_state_updated_at
  BEFORE UPDATE ON demo_account_state
  FOR EACH ROW EXECUTE FUNCTION update_demo_account_state_updated_at();

-- RLS: a user may only ever read/write their own row. Only demo@demo.com is
-- expected to have one, but the policy isn't email-scoped so it stays correct
-- if a second demo-style account is ever added.
ALTER TABLE demo_account_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_demo_state"
  ON demo_account_state FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users_write_own_demo_state"
  ON demo_account_state FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "strike_admin_read_demo_state"
  ON demo_account_state FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'strike_admin')
  );
