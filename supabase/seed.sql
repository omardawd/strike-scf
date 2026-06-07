-- ============================================================================
-- Strike SCF — Dev seed data
-- ----------------------------------------------------------------------------
-- Run via:  npx supabase db reset   (applies migrations, then this file)
-- All passwords:  DevPass123!
--
-- Accounts created:
--   sarah@atlasbank.dev     bank_admin           (Atlas Bank)
--   james@atlasbank.dev     bank_credit_officer  (Atlas Bank)
--   buyer@pacific.dev       org_admin            (Pacific Dynamics — anchor/buyer)
--   supplier@westcoast.dev  org_admin            (Westcoast Fabricators — supplier)
--   supplier@coastal.dev    org_admin            (Coastal Suppliers — supplier)
--   admin@strikescf.com     strike_admin         (Strike platform)
--
-- UUIDs are hardcoded ONLY here (seed files are the sanctioned exception).
-- Atlas Bank uses NEXT_PUBLIC_DEV_BANK_ID so the dev env lines up out of the box.
--
-- NOTE: This seed targets the schema documented in apps/web/CLAUDE.md. It has not
-- been executed against the live DB (see BLOCKED.md / T1.2 — no DB access yet).
-- It is idempotent where practical (ON CONFLICT) so it is safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Auth users  (auth.users + auth.identities). users.id == auth.users.id
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sarah@atlasbank.dev',    crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sarah Chen"}',    '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'james@atlasbank.dev',    crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"James Okafor"}',  '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'buyer@pacific.dev',      crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Maria Delgado"}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'supplier@westcoast.dev', crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Rachel Wong"}',   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'supplier@coastal.dev',   crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Mike Alvarez"}',  '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0d000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@strikescf.com',    crypt('DevPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Strike Admin"}',  '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
VALUES
  (gen_random_uuid(), '0a000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001', '{"sub":"0a000000-0000-0000-0000-000000000001","email":"sarah@atlasbank.dev"}',    'email', now(), now(), now()),
  (gen_random_uuid(), '0a000000-0000-0000-0000-000000000002', '0a000000-0000-0000-0000-000000000002', '{"sub":"0a000000-0000-0000-0000-000000000002","email":"james@atlasbank.dev"}',    'email', now(), now(), now()),
  (gen_random_uuid(), '0b000000-0000-0000-0000-000000000001', '0b000000-0000-0000-0000-000000000001', '{"sub":"0b000000-0000-0000-0000-000000000001","email":"buyer@pacific.dev"}',      'email', now(), now(), now()),
  (gen_random_uuid(), '0c000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', '{"sub":"0c000000-0000-0000-0000-000000000001","email":"supplier@westcoast.dev"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '0c000000-0000-0000-0000-000000000002', '0c000000-0000-0000-0000-000000000002', '{"sub":"0c000000-0000-0000-0000-000000000002","email":"supplier@coastal.dev"}',   'email', now(), now(), now()),
  (gen_random_uuid(), '0d000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000001', '{"sub":"0d000000-0000-0000-0000-000000000001","email":"admin@strikescf.com"}',    'email', now(), now(), now())
ON CONFLICT (provider_id, provider) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Bank
-- ---------------------------------------------------------------------------
INSERT INTO public.banks (
  id, legal_name, display_name, institution_type,
  primary_contact_name, primary_contact_email, status, created_at, updated_at
)
VALUES (
  'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
  'Atlas Bank, N.A.', 'Atlas Bank', 'commercial_bank',
  'Sarah Chen', 'sarah@atlasbank.dev', 'active', now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Organizations  (1 anchor/buyer + 2 suppliers)
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (
  id, bank_id, type, status, legal_name, doing_business_as, ein, business_type,
  state_of_incorporation, address_line1, city, state, zip,
  years_in_operation, annual_revenue_range, industry_naics,
  primary_contact_name, primary_contact_title, primary_contact_phone, primary_contact_email,
  kyb_status, credit_score, risk_tier, country_of_origin,
  network_visible, passport_score, created_at, updated_at
)
VALUES
  ('1a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', 'anchor',   'approved', 'Pacific Dynamics Inc.',      'Pacific Dynamics',      '47-1234567', 'corporation', 'DE', '500 Harbor Blvd',     'San Francisco', 'CA', '94105', 18, '$500M-$1B', '333120', 'Maria Delgado', 'VP Procurement', '+1-415-555-0101', 'buyer@pacific.dev',      'approved', 88, 'A', 'US', true, 88, now(), now()),
  ('1b000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', 'supplier', 'approved', 'Westcoast Fabricators LLC',  'Westcoast Fabricators', '47-2345678', 'llc',         'CA', '1200 Industrial Way', 'Oakland',       'CA', '94607', 12, '$10M-$50M',  '332710', 'Rachel Wong',   'CFO',            '+1-510-555-0102', 'supplier@westcoast.dev', 'approved', 76, 'B', 'US', true, 79, now(), now()),
  ('1b000000-0000-0000-0000-000000000002', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', 'supplier', 'approved', 'Coastal Suppliers Co.',      'Coastal Suppliers',     '47-3456789', 'corporation', 'WA', '88 Marine Dr',        'Seattle',       'WA', '98101', 7,  '$1M-$10M',   '423510', 'Mike Alvarez',  'Owner',          '+1-206-555-0103', 'supplier@coastal.dev',   'approved', 64, 'C', 'US', true, 67, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. App users  (public.users). Upsert in case a handle_new_user trigger
--    already created stub rows from the auth.users inserts above.
-- ---------------------------------------------------------------------------
INSERT INTO public.users (id, email, full_name, role, bank_id, org_id, is_active, created_at, updated_at)
VALUES
  ('0a000000-0000-0000-0000-000000000001', 'sarah@atlasbank.dev',    'Sarah Chen',    'bank_admin',          'ff1a209f-aa2a-471c-95c8-9d01018cdecd', NULL,                                   true, now(), now()),
  ('0a000000-0000-0000-0000-000000000002', 'james@atlasbank.dev',    'James Okafor',  'bank_credit_officer', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', NULL,                                   true, now(), now()),
  ('0b000000-0000-0000-0000-000000000001', 'buyer@pacific.dev',      'Maria Delgado', 'org_admin',           NULL,                                   '1a000000-0000-0000-0000-000000000001', true, now(), now()),
  ('0c000000-0000-0000-0000-000000000001', 'supplier@westcoast.dev', 'Rachel Wong',   'org_admin',           NULL,                                   '1b000000-0000-0000-0000-000000000001', true, now(), now()),
  ('0c000000-0000-0000-0000-000000000002', 'supplier@coastal.dev',   'Mike Alvarez',  'org_admin',           NULL,                                   '1b000000-0000-0000-0000-000000000002', true, now(), now()),
  ('0d000000-0000-0000-0000-000000000001', 'admin@strikescf.com',    'Strike Admin',  'strike_admin',        NULL,                                   NULL,                                   true, now(), now())
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
  bank_id = EXCLUDED.bank_id, org_id = EXCLUDED.org_id, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Program  (Atlas Bank, reverse factoring for Pacific Dynamics' suppliers)
-- ---------------------------------------------------------------------------
INSERT INTO public.programs (
  id, bank_id, created_by_user_id, name, financing_types,
  program_limit, per_supplier_sublimit, min_deal_size, max_deal_size,
  max_invoice_age_days, standard_tenor_days, currency, is_open_account,
  status, activated_at, created_at, updated_at
)
VALUES (
  '2a000000-0000-0000-0000-000000000001',
  'ff1a209f-aa2a-471c-95c8-9d01018cdecd',
  '0a000000-0000-0000-0000-000000000001',
  'Pacific Dynamics Supplier Finance',
  ARRAY['reverse_factoring','factoring','po_financing','open'],
  25000000, 5000000, 10000, 2000000,
  90, 60, 'USD', true,
  'active', now(), now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Program enrollments  (both suppliers active under the program)
-- ---------------------------------------------------------------------------
INSERT INTO public.program_enrollments (
  id, program_id, org_id, anchor_org_id, enrolled_by_user_id, status, enrolled_at, created_at, updated_at
)
VALUES
  ('2b000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001', 'active', now(), now(), now()),
  ('2b000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001', 'active', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Transactions — one per lifecycle state (16 states), alternating supplier.
--    Pre-approval states leave financing_amount_approved / rate / repayment NULL.
-- ---------------------------------------------------------------------------
INSERT INTO public.transactions (
  id, program_id, bank_id, anchor_id, supplier_id, created_by_user_id,
  type, anchor_initiated, status, invoice_number, invoice_date, invoice_due_date,
  invoice_amount, financing_amount_requested, financing_amount_approved,
  financing_rate_apr, tenor_days, repayment_due_date,
  goods_services_description, created_at, updated_at
)
VALUES
  ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'draft',                                'INV-0001', now() - interval '5 days',  now() + interval '55 days', 50000,  50000,  NULL,   NULL, 60, NULL,                       'Machined steel brackets',    now(), now()),
  ('3a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'pending_anchor_initiation',            'INV-0002', now() - interval '6 days',  now() + interval '54 days', 75000,  75000,  NULL,   NULL, 60, NULL,                       'Industrial fasteners',       now(), now()),
  ('3a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'pending_anchor_approval',              'INV-0003', now() - interval '7 days',  now() + interval '53 days', 120000, 120000, NULL,   NULL, 60, NULL,                       'CNC-milled housings',        now(), now()),
  ('3a000000-0000-0000-0000-000000000004', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'pending_anchor_confirmation',          'INV-0004', now() - interval '8 days',  now() + interval '52 days', 90000,  90000,  NULL,   NULL, 60, NULL,                       'Packaging materials',        now(), now()),
  ('3a000000-0000-0000-0000-000000000005', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'pending_bank_review',                  'INV-0005', now() - interval '9 days',  now() + interval '51 days', 200000, 200000, NULL,   NULL, 60, NULL,                       'Precision bearings',         now(), now()),
  ('3a000000-0000-0000-0000-000000000006', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'more_info_requested',                  'INV-0006', now() - interval '10 days', now() + interval '50 days', 60000,  60000,  NULL,   NULL, 60, NULL,                       'Raw aluminum stock',         now(), now()),
  ('3a000000-0000-0000-0000-000000000007', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'financing_approved_pending_collateral','INV-0007', now() - interval '12 days', now() + interval '48 days', 150000, 150000, 135000, 8.5,  60, now() + interval '60 days', 'Welded subassemblies',       now(), now()),
  ('3a000000-0000-0000-0000-000000000008', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'financing_approved',                   'INV-0008', now() - interval '13 days', now() + interval '47 days', 180000, 180000, 162000, 8.5,  60, now() + interval '60 days', 'Coastal logistics services', now(), now()),
  ('3a000000-0000-0000-0000-000000000009', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'funded',                               'INV-0009', now() - interval '20 days', now() + interval '40 days', 110000, 110000, 99000,  7.9,  60, now() + interval '40 days', 'Sheet metal enclosures',     now(), now()),
  ('3a000000-0000-0000-0000-000000000010', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'po_financing',      true, 'pending_delivery_confirmation',        'INV-0010', now() - interval '21 days', now() + interval '39 days', 95000,  95000,  85500,  8.2,  60, now() + interval '39 days', 'PO: marine hardware',        now(), now()),
  ('3a000000-0000-0000-0000-000000000011', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'delivery_confirmed',                   'INV-0011', now() - interval '25 days', now() + interval '35 days', 130000, 130000, 117000, 8.0,  60, now() + interval '35 days', 'Assembled control panels',   now(), now()),
  ('3a000000-0000-0000-0000-000000000012', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'repayment_due',                        'INV-0012', now() - interval '55 days', now() + interval '5 days',  140000, 140000, 126000, 8.3,  60, now() + interval '5 days',  'Bulk packaging supply',      now(), now()),
  ('3a000000-0000-0000-0000-000000000013', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'completed',                            'INV-0013', now() - interval '90 days', now() - interval '30 days', 100000, 100000, 90000,  7.5,  60, now() - interval '30 days', 'Fabricated frames (closed)', now(), now()),
  ('3a000000-0000-0000-0000-000000000014', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'rejected',                             'INV-0014', now() - interval '15 days', now() + interval '45 days', 70000,  70000,  NULL,   NULL, 60, NULL,                       'Incomplete documentation',   now(), now()),
  ('3a000000-0000-0000-0000-000000000015', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'cancelled',                            'INV-0015', now() - interval '16 days', now() + interval '44 days', 80000,  80000,  NULL,   NULL, 60, NULL,                       'Cancelled by supplier',      now(), now()),
  ('3a000000-0000-0000-0000-000000000016', '2a000000-0000-0000-0000-000000000001', 'ff1a209f-aa2a-471c-95c8-9d01018cdecd', '1a000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-000000000001', 'reverse_factoring', true, 'in_dispute',                           'INV-0016', now() - interval '40 days', now() + interval '20 days', 115000, 115000, 103500, 8.1,  60, now() + interval '20 days', 'Disputed delivery quantity', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Transaction events — a creation event per seeded transaction
-- ---------------------------------------------------------------------------
INSERT INTO public.transaction_events (
  id, transaction_id, event_type, from_status, to_status, actor_id, actor_type, notes, created_at
)
SELECT
  gen_random_uuid(), t.id, 'created', NULL, t.status,
  t.created_by_user_id, 'user', 'Seeded transaction in state: ' || t.status, now()
FROM public.transactions t
WHERE t.id::text LIKE '3a000000-0000-0000-0000-%'
ON CONFLICT DO NOTHING;
