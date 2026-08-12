-- Canonical append-only audit-event log (ASSESSMENT.md P2-3 / Track J).
-- Distinct from agent_actions (AI tool/action log), transaction_events, and
-- deal_events (business lifecycle logs) — this table is for security- and
-- compliance-relevant events those don't cover: role/permission changes,
-- org-initiated KYB status transitions, bank-detail changes, and document
-- access. Does not replace those existing logs; complements them.

CREATE TABLE audit_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_role      TEXT,
  tenant_org_id   UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  tenant_bank_id  UUID        REFERENCES banks(id) ON DELETE SET NULL,
  action          TEXT        NOT NULL,
  target_type     TEXT        NOT NULL,
  target_id       TEXT,
  request_id      TEXT,
  source          TEXT        NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'cron', 'ai_tool', 'dispatch')),
  outcome         TEXT        NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  -- Safe-subset before/after snapshots only — the write helper (lib/audit/log.ts)
  -- is responsible for never including document bodies, full bank account/
  -- routing numbers, secrets, or raw AI prompts. See docs/security/AI_GOVERNANCE.md.
  before_data     JSONB,
  after_data      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_org_idx ON audit_events (tenant_org_id, created_at DESC);
CREATE INDEX audit_events_bank_idx ON audit_events (tenant_bank_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, created_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_scoped_read" ON audit_events
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (tenant_org_id = current_org_id())
    OR (tenant_bank_id = current_bank_id())
    OR is_strike_admin()
  );

-- "Audit writes cannot silently disappear" (Track J requirement): a
-- database-level trigger blocking UPDATE/DELETE outright, which even the
-- service-role client cannot bypass (RLS can be bypassed by service_role;
-- triggers cannot). The only way to remove an audit row is a manual,
-- deliberate migration — never application code, accidental or otherwise.
CREATE OR REPLACE FUNCTION audit_events_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events rows are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();
