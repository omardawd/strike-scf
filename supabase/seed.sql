-- Strike SCF — Dev Seed Data
-- ─────────────────────────────────────────────────────────────────────────────
-- Prerequisites:
--   1. Create auth users first (via Supabase dashboard or CLI):
--        supabase auth create --email sarah@atlasbank.dev --password DevPass123!
--        supabase auth create --email james@pacdyn.dev   --password DevPass123!
--        supabase auth create --email rachel@westcoast.dev --password DevPass123!
--        supabase auth create --email mike@deltacomp.dev --password DevPass123!
--   2. Copy the returned UUIDs into the users INSERT below.
--   3. Run:  supabase db reset  (which applies migrations then this seed)
--
-- For quick local testing you can also insert directly into auth.users:
--   the placeholder UUIDs below (a1…001, a2…002 etc.) must match real
--   auth.users rows — create them via the Supabase Studio UI first.
-- ─────────────────────────────────────────────────────────────────────────────

-- Placeholder auth UUIDs — replace with real ones after creating auth users:
-- sarah@atlasbank.dev  → a1000000-0000-0000-0000-000000000001
-- james@pacdyn.dev     → a2000000-0000-0000-0000-000000000002
-- rachel@westcoast.dev → a3000000-0000-0000-0000-000000000003
-- mike@deltacomp.dev   → a4000000-0000-0000-0000-000000000004

-- ── Banks ────────────────────────────────────────────────────────────────────
-- Dev bank ID matches NEXT_PUBLIC_DEV_BANK_ID env var.
INSERT INTO banks (id, name, created_at)
VALUES ('ff1a209f-aa2a-471c-95c8-9d01018cdecd', 'Atlas Bank', NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Organizations ─────────────────────────────────────────────────────────────
INSERT INTO organizations (id, legal_name, type, kyb_status, status, bank_id, created_at)
VALUES
  ('b1000000-0000-0000-0000-000000000001',
   'Pacific Dynamics Corp',
   'anchor',
   'approved',
   'active',
   'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
   NOW()),

  ('b2000000-0000-0000-0000-000000000002',
   'Westcoast Fabricators LLC',
   'supplier',
   'approved',
   'active',
   'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
   NOW()),

  ('b3000000-0000-0000-0000-000000000003',
   'Delta Components Inc',
   'supplier',
   'approved',
   'active',
   'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
   NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Public users ──────────────────────────────────────────────────────────────
-- id must match the auth.users UUID created above.
INSERT INTO users (id, full_name, email, role, bank_id, org_id, created_at)
VALUES
  ('b7509d2a-d652-4540-82f2-6889fe38d73e',
   'Sarah Chen',
   'sarah@atlasbank.dev',
   'bank_admin',
   'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
   NULL,
   NOW()),

  ('709a8599-2d7c-4344-baf5-49b05c80a460',
   'James Patel',
   'james@pacdyn.dev',
   'anchor_admin',
   NULL,
   'b1000000-0000-0000-0000-000000000001',
   NOW()),

  ('2c3273a4-7ef5-4fef-be96-adc4d9ad8c2a',
   'Rachel Kim',
   'rachel@westcoast.dev',
   'supplier_admin',
   NULL,
   'b2000000-0000-0000-0000-000000000002',
   NOW()),

  ('bd403c45-7fd3-4ee2-87e1-dd6ba5a5144e',
   'Mike Torres',
   'mike@deltacomp.dev',
   'supplier_admin',
   NULL,
   'b3000000-0000-0000-0000-000000000003',
   NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Programs ──────────────────────────────────────────────────────────────────
INSERT INTO programs (
  id,
  bank_id,
  created_by_user_id,
  name,
  financing_types,
  status,
  program_limit,
  per_supplier_sublimit,
  min_deal_size,
  max_deal_size,
  standard_tenor_days,
  currency,
  created_at
)
VALUES (
  'c1000000-0000-0000-0000-000000000001',
  'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
  'a1000000-0000-0000-0000-000000000001',
  'Pacific Trade Finance',
  ARRAY['reverse_factoring'],
  'active',
  5000000,
  1000000,
  50000,
  500000,
  60,
  'USD',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ── Program enrollments ───────────────────────────────────────────────────────
-- Each row needs anchor_org_id so the network view and anchor's "My Programs" work.
-- The anchor's own row has org_id = anchor_org_id (sentinel that identifies the anchor).
INSERT INTO program_enrollments (id, program_id, org_id, anchor_org_id, status, created_at)
VALUES
  -- Anchor enrollment (org_id = anchor_org_id = anchor's org)
  ('d0000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'active',
   NOW()),

  -- Supplier enrollments reference the anchor via anchor_org_id
  ('d1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001',
   'active',
   NOW()),

  ('d2000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000001',
   'b3000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'active',
   NOW())
ON CONFLICT (id) DO NOTHING;
