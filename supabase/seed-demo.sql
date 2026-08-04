-- ============================================================================
-- Strike SCF — Demo tenant seed data (cinematic product-tour account)
-- ----------------------------------------------------------------------------
-- Powers the scripted product tour shown to prospective clients under the
-- single login demo@demo.com / DemoPass123!. Entirely isolated, fictional
-- entities — no overlap with supabase/seed.sql's dev accounts (Atlas Bank /
-- Pacific Dynamics / Westcoast / Coastal) or the real Walmart/Rocket Corp
-- accounts created via live /signup testing (see apps/web/CLAUDE.md).
--
-- UUID namespace: all ids in this file use the `de` prefix (never used by
-- supabase/seed.sql, which uses 0a/0b/0c/0d + 1a/1b/2a/2b/3a), verified
-- against the live DB to not collide with any existing row before this file
-- was finalized.
--
-- Accounts created (all password DemoPass123!):
--   demo@demo.com                     org_admin  (Harborview Retail Group — anchor/buyer; THE demo login)
--   admin@ironbridgesteel.example     org_admin  (Ironbridge Steel Works — supplier; FK-completeness only, not
--   admin@cedarlinepkg.example        org_admin  (Cedarline Packaging Solutions — supplier;  a documented tour
--   admin@vantagecircuit.example      org_admin  (Vantage Circuit Technologies — supplier;   login)
--
-- Schema verified directly against the live Supabase project via
-- information_schema / pg_enum before writing (apps/web/CLAUDE.md's v2-table
-- section is explicitly abbreviated and, confirmed live, is stale in at least
-- two places relevant here: organizations.risk_tier is actually the enum
-- green|amber|red — NOT 'A'|'B'|'C'|'D' as documented — and the live
-- financing_type enum is reverse_factoring|invoice_factoring|po_financing|
-- dynamic_discounting, NOT the 'factoring'/'open' values seed.sql assumes).
--
-- Platform-access gate (apps/web/app/(portal)/layout.tsx, NOT
-- network_visible as CLAUDE.md's Ghost-mode section implies): an org must
-- have kyb_status = 'approved' exactly, or every portal page renders only
-- <KybStatusPage/>. Every organization below sets kyb_status='approved'.
--
-- financing_requests were verified independent of programs/program_enrollments
-- (app/api/marketplace/financing/route.ts — a request only needs a deal_id +
-- requesting_org_id, no program FK anywhere in the table). The bank/program/
-- enrollments below exist for the legacy SCF Programs surface, not as a
-- prerequisite for marketplace financing.
--
-- Idempotent: every insert uses a hardcoded `de*` UUID + ON CONFLICT, so this
-- file is safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Auth users (auth.users + auth.identities). users.id == auth.users.id
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'demo@demo.com',                   crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jordan Blake"}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin@ironbridgesteel.example',   crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Dana Reyes"}',   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'admin@cedarlinepkg.example',      crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Nair"}',   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'admin@vantagecircuit.example',    crypt('DemoPass123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Marcus Webb"}',  '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
VALUES
  (gen_random_uuid(), 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', '{"sub":"de000000-0000-0000-0000-000000000001","email":"demo@demo.com"}',                 'email', now(), now(), now()),
  (gen_random_uuid(), 'de000000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-000000000002', '{"sub":"de000000-0000-0000-0000-000000000002","email":"admin@ironbridgesteel.example"}', 'email', now(), now(), now()),
  (gen_random_uuid(), 'de000000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000003', '{"sub":"de000000-0000-0000-0000-000000000003","email":"admin@cedarlinepkg.example"}',    'email', now(), now(), now()),
  (gen_random_uuid(), 'de000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000004', '{"sub":"de000000-0000-0000-0000-000000000004","email":"admin@vantagecircuit.example"}',  'email', now(), now(), now())
ON CONFLICT (provider_id, provider) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Bank (fictional financing bank offering the suppliers' Strike Place deals)
-- ---------------------------------------------------------------------------
INSERT INTO public.banks (
  id, legal_name, display_name, institution_type,
  primary_contact_name, primary_contact_email, status, marketplace_active, created_at, updated_at
)
VALUES (
  'de100000-0000-0000-0000-000000000001',
  'Continental Trade Bank, N.A.', 'Continental Trade Bank', 'commercial_bank',
  'Morgan Ellis', 'morgan.ellis@continentaltradebank.example', 'active', true, now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Organizations — 1 anchor/buyer (the demo tenant) + 3 suppliers
--    kyb_status='approved' is REQUIRED on every row: apps/web/app/(portal)/
--    layout.tsx gates the entire portal on org.kyb_status === 'approved'
--    (network_visible is a separate, secondary counterparty-visibility flag).
--    risk_tier uses the live enum (green|amber|red) — NOT 'A'|'B'|'C'|'D'.
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (
  id, primary_bank_id, type, status, legal_name, doing_business_as, ein, business_type,
  state_of_incorporation, country_of_incorporation,
  address_line1, city, state, zip, country,
  industry_naics, description, years_in_operation, annual_revenue_range, employee_count_range,
  primary_contact_name, primary_contact_title, primary_contact_phone, primary_contact_email,
  kyb_status, kyb_submitted_at, kyb_approved_at,
  credit_score, risk_score, risk_tier, country_of_origin,
  product_categories, sourcing_countries, primary_currency, ai_matching_opt_in,
  network_visible, passport_score, passport_published_at, trade_count_total, trade_volume_total,
  created_at, updated_at, logo_url
)
VALUES
  ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000001', 'anchor', 'active',
   'Harborview Retail Group, Inc.', 'Harborview Retail', '88-4471290', 'corporation',
   'DE', 'US', '4600 Commerce Pkwy', 'Dallas', 'TX', '75201', 'US',
   '452319', 'National general-merchandise retailer and distributor operating regional distribution centers across the US.',
   22, '$1B-$5B', '5,000-10,000',
   'Jordan Blake', 'VP, Supply Chain & Procurement', '+1-214-555-0142', 'demo@demo.com',
   'approved', now() - interval '90 days', now() - interval '85 days',
   82, 18, 'green', 'US',
   '["steel","packaging","electronics components","retail fixtures"]'::jsonb, '["US","MX","VN"]'::jsonb, 'USD', true,
   true, 84, now() - interval '85 days', 6, 1180000,
   now() - interval '90 days', now(),
   -- Inline lettermark SVG data URI (no real brand asset for a fictional
   -- company) — renders in place of the passport page's plain "HR" initials
   -- fallback avatar.
   'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" y1="0" x2="1" y2="1"%3E%3Cstop offset="0" stop-color="%230F1B3D"/%3E%3Cstop offset="1" stop-color="%231E3A6E"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="64" height="64" rx="14" fill="url(%23g)"/%3E%3Ctext x="32" y="41" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="%23D4AF6A" text-anchor="middle"%3EHR%3C/text%3E%3C/svg%3E'),

  ('de200000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000001', 'supplier', 'active',
   'Ironbridge Steel Works, Inc.', 'Ironbridge Steel Works', '88-5512034', 'corporation',
   'PA', 'US', '1180 Furnace Row', 'Pittsburgh', 'PA', '15222', 'US',
   '331110', 'Structural and sheet steel manufacturer supplying fabricators, retailers, and industrial buyers across North America.',
   15, '$50M-$100M', '250-500',
   'Dana Reyes', 'CFO', '+1-412-555-0118', 'admin@ironbridgesteel.example',
   'approved', now() - interval '120 days', now() - interval '115 days',
   78, 24, 'green', 'US',
   '["steel","structural steel","metal fabrication"]'::jsonb, '["US"]'::jsonb, 'USD', true,
   true, 81, now() - interval '115 days', 41, 6400000,
   now() - interval '120 days', now(), NULL),

  ('de200000-0000-0000-0000-000000000003', 'de100000-0000-0000-0000-000000000001', 'supplier', 'active',
   'Cedarline Packaging Solutions LLC', 'Cedarline Packaging', '88-6623145', 'llc',
   'NC', 'US', '540 Freight Yard Rd', 'Charlotte', 'NC', '28206', 'US',
   '322211', 'Corrugated and protective packaging manufacturer serving retail and consumer-goods supply chains.',
   9, '$10M-$50M', '100-250',
   'Priya Nair', 'Owner & CEO', '+1-704-555-0187', 'admin@cedarlinepkg.example',
   'approved', now() - interval '75 days', now() - interval '70 days',
   68, 34, 'amber', 'US',
   '["packaging","corrugated boxes","protective packaging"]'::jsonb, '["US"]'::jsonb, 'USD', true,
   true, 71, now() - interval '70 days', 19, 980000,
   now() - interval '75 days', now(), NULL),

  ('de200000-0000-0000-0000-000000000004', 'de100000-0000-0000-0000-000000000001', 'supplier', 'active',
   'Vantage Circuit Technologies Inc.', 'Vantage Circuit Technologies', '88-7734256', 'corporation',
   'TX', 'US', '2200 Innovation Loop', 'Austin', 'TX', '78741', 'US',
   '334418', 'Contract electronics manufacturer specializing in SMT PCB assembly for retail, POS, and IoT hardware.',
   11, '$25M-$50M', '150-300',
   'Marcus Webb', 'VP Operations', '+1-512-555-0163', 'admin@vantagecircuit.example',
   'approved', now() - interval '60 days', now() - interval '55 days',
   80, 20, 'green', 'US',
   '["electronics components","PCB assembly","connectors"]'::jsonb, '["US"]'::jsonb, 'USD', true,
   true, 85, now() - interval '55 days', 27, 3100000,
   now() - interval '60 days', now(), NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. App users (public.users)
-- ---------------------------------------------------------------------------
INSERT INTO public.users (id, email, full_name, role, bank_id, org_id, is_active, created_at, updated_at)
VALUES
  ('de000000-0000-0000-0000-000000000001', 'demo@demo.com',                 'Jordan Blake', 'org_admin', NULL, 'de200000-0000-0000-0000-000000000001', true, now(), now()),
  ('de000000-0000-0000-0000-000000000002', 'admin@ironbridgesteel.example', 'Dana Reyes',   'org_admin', NULL, 'de200000-0000-0000-0000-000000000002', true, now(), now()),
  ('de000000-0000-0000-0000-000000000003', 'admin@cedarlinepkg.example',    'Priya Nair',   'org_admin', NULL, 'de200000-0000-0000-0000-000000000003', true, now(), now()),
  ('de000000-0000-0000-0000-000000000004', 'admin@vantagecircuit.example',  'Marcus Webb',  'org_admin', NULL, 'de200000-0000-0000-0000-000000000004', true, now(), now())
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
  bank_id = EXCLUDED.bank_id, org_id = EXCLUDED.org_id, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Program (Continental Trade Bank, reverse/invoice factoring + PO financing
--    for Harborview Retail's supplier network). NOTE: financing_type enum is
--    reverse_factoring|invoice_factoring|po_financing|dynamic_discounting live
--    — 'factoring'/'open' (used by supabase/seed.sql) are NOT valid values.
-- ---------------------------------------------------------------------------
INSERT INTO public.programs (
  id, bank_id, created_by_user_id, name, financing_types,
  program_limit, per_supplier_sublimit, min_deal_size, max_deal_size,
  max_invoice_age_days, standard_tenor_days, currency, is_open_account,
  status, activated_at, created_at, updated_at
)
VALUES (
  'de300000-0000-0000-0000-000000000001',
  'de100000-0000-0000-0000-000000000001',
  NULL,
  'Continental Trade Bank Supplier Finance Program',
  ARRAY['reverse_factoring','invoice_factoring','po_financing']::financing_type[],
  20000000, 4000000, 10000, 1500000,
  90, 60, 'USD', true,
  'active', now() - interval '110 days', now() - interval '110 days', now()
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Program enrollments (all 3 suppliers active under Harborview's program)
-- ---------------------------------------------------------------------------
INSERT INTO public.program_enrollments (
  id, program_id, org_id, anchor_org_id, enrolled_by_user_id, status, enrolled_at, created_at, updated_at
)
VALUES
  ('de400000-0000-0000-0000-000000000001', 'de300000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001', NULL, 'active', now() - interval '100 days', now() - interval '100 days', now()),
  ('de400000-0000-0000-0000-000000000002', 'de300000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000001', NULL, 'active', now() - interval '70 days',  now() - interval '70 days',  now()),
  ('de400000-0000-0000-0000-000000000003', 'de300000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000001', NULL, 'active', now() - interval '55 days',  now() - interval '55 days',  now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Org agents — ACTIVE on all four orgs (buyer + 3 suppliers) so autonomous
--    agent-to-agent negotiation works on both sides of any live tour scenario
--    (CLAUDE.md: "needs BOTH tick functions, not just one" — runAgentTick on
--    the GATE-1 side AND runListingDefenseTick on the listing-owner side).
-- ---------------------------------------------------------------------------
INSERT INTO public.org_agents (id, org_id, name, persona, is_active, goals, created_at, updated_at)
VALUES
  ('de500000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'Harborview Strike Agent',       'Sources retail supply-chain inputs at disciplined prices; prioritizes reliable delivery windows over marginal savings.', true, '[]'::jsonb, now() - interval '85 days', now()),
  ('de500000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002', 'Ironbridge Steel Works Strike Agent', 'Defends listing prices against current mill index benchmarks; will concede modestly to close volume orders.', true, '[]'::jsonb, now() - interval '110 days', now()),
  ('de500000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000003', 'Cedarline Packaging Strike Agent',    'Flexible on price for repeat-order commitments; protects margin on custom-print runs.', true, '[]'::jsonb, now() - interval '65 days', now()),
  ('de500000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000004', 'Vantage Circuit Strike Agent',        'Prioritizes fast-turn production slots; negotiates tenor over unit price where possible.', true, '[]'::jsonb, now() - interval '50 days', now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Marketplace listings — 4 live/browsable + 1 already matched (the listing
--    behind the pre-completed deal in section 9, kept separate from the live
--    listings so a fresh tour negotiation always has untouched inventory).
-- ---------------------------------------------------------------------------
INSERT INTO public.marketplace_listings (
  id, org_id, listing_type, status, title, description, category,
  quantity, unit, target_price, currency, incoterms, delivery_location, delivery_deadline,
  payment_terms, origin_country, network_visible, visibility, view_count, offer_count,
  matched_deal_id, created_at, updated_at
)
VALUES
  ('de600000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000002', 'product_service', 'active',
   'Hot-Rolled Steel Coils — Grade A36, 500 MT',
   'Hot-rolled ASTM A36 steel coil, mill-certified, suitable for structural fabrication and retail fixture manufacturing. Available for immediate scheduling from our Pittsburgh mill.',
   'Metals & Steel', 500, 'MT', 390000, 'USD', 'FOB', 'Port of Houston, TX', (now() + interval '45 days')::date,
   'Net 60', 'US', true, 'public', 38, 0,
   -- Kept close to "now" (not '18 days' like a realistically-aged listing
   -- would be) because the demo tour's Strike Place beat spotlights this
   -- listing by data-demo-target, and the marketplace grid's default "Most
   -- Recent" sort only fetches the top 20 listings — an older created_at
   -- silently falls off that page as other listings accumulate. /api/demo/reset
   -- also re-bumps this on every replay; this seed-time value only matters for
   -- a pristine environment's very first, reset-less playthrough.
   NULL, now() - interval '30 minutes', now() - interval '2 days'),

  ('de600000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002', 'product_service', 'active',
   'Galvanized Steel Sheet — 4x8 Panels, 2,000 Units',
   '14-gauge hot-dip galvanized steel sheet, 4x8ft panels, corrosion-resistant finish. Common stock item, ships within 2 weeks of order.',
   'Metals & Steel', 2000, 'units', 290000, 'USD', 'FOB', 'Pittsburgh, PA', (now() + interval '30 days')::date,
   'Net 45', 'US', true, 'public', 21, 0,
   NULL, now() - interval '12 days', now() - interval '1 days'),

  ('de600000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000003', 'product_service', 'active',
   'Corrugated Shipping Cartons — Custom Print, 250,000 Units',
   'RSC-style corrugated shipping cartons, custom single-color print, ECT-32 board. High-volume production run for retail distribution replenishment.',
   'Packaging & Materials', 250000, 'units', 155000, 'USD', 'FOB', 'Charlotte, NC', (now() + interval '35 days')::date,
   'Net 30', 'US', true, 'public', 15, 0,
   NULL, now() - interval '9 days', now() - interval '1 days'),

  ('de600000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000004', 'product_service', 'active',
   'SMT PCB Assembly — Retail POS Controller Boards, 15,000 Units',
   'Turnkey SMT assembly for retail POS controller boards, IPC-A-610 Class 2, includes AOI and functional test. Components sourced and stocked, ready for a production slot.',
   'Electronics & Components', 15000, 'units', 577500, 'USD', 'DDP', 'Austin, TX', (now() + interval '50 days')::date,
   'Net 45', 'US', true, 'public', 27, 0,
   NULL, now() - interval '6 days', now()),

  ('de600000-0000-0000-0000-000000000005', 'de200000-0000-0000-0000-000000000002', 'product_service', 'matched',
   'Structural Steel Angle Bar — 3in x 3in, 300 MT',
   'ASTM A36 structural steel angle bar, 3in x 3in x 3/8in, mill-certified. Sourced for retail fixture and shelving fabrication runs.',
   'Metals & Steel', 300, 'MT', 243000, 'USD', 'FOB', 'Port of Houston, TX', (now() - interval '10 days')::date,
   'Net 60', 'US', true, 'public', 56, 4,
   NULL, now() - interval '35 days', now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;
-- matched_deal_id is backfilled by an UPDATE after section 9 (deals) below —
-- marketplace_listings.matched_deal_id has an FK to deals.id, so the deal row
-- must exist first.

-- ---------------------------------------------------------------------------
-- 8. Listing line items (one per listing, matching quantity/unit_price)
-- ---------------------------------------------------------------------------
INSERT INTO public.listing_line_items (
  id, listing_id, name, description, quantity, unit, unit_price, currency, sort_order, created_at
)
VALUES
  ('de610000-0000-0000-0000-000000000001', 'de600000-0000-0000-0000-000000000001', 'Hot-rolled steel coil, Grade A36',            'Mill-certified structural steel coil', 500,    'MT',    780,   'USD', 0, now() - interval '18 days'),
  ('de610000-0000-0000-0000-000000000002', 'de600000-0000-0000-0000-000000000002', 'Galvanized steel sheet, 4x8ft panel, 14-gauge', 'Hot-dip galvanized, corrosion-resistant', 2000, 'units', 145,   'USD', 0, now() - interval '12 days'),
  ('de610000-0000-0000-0000-000000000003', 'de600000-0000-0000-0000-000000000003', 'Corrugated shipping carton, custom print',     'RSC style, ECT-32 board',              250000, 'units', 0.62, 'USD', 0, now() - interval '9 days'),
  ('de610000-0000-0000-0000-000000000004', 'de600000-0000-0000-0000-000000000004', 'SMT-assembled PCB, retail POS controller board', 'IPC-A-610 Class 2, AOI + functional test', 15000, 'units', 38.50, 'USD', 0, now() - interval '6 days'),
  ('de610000-0000-0000-0000-000000000005', 'de600000-0000-0000-0000-000000000005', 'Structural steel angle bar, 3in x 3in x 3/8in', 'ASTM A36, mill-certified',              300,    'MT',    810,   'USD', 0, now() - interval '35 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Deal — one pre-completed deal (Harborview Retail buyer <-> Ironbridge
--    Steel Works supplier) with a full multi-round negotiation history,
--    for the "real negotiation history" tour scene. deal_source='marketplace',
--    linked to the now-matched listing in section 7. Price converges over
--    4 counter-rounds (see agent_actions in section 11) before acceptance.
-- ---------------------------------------------------------------------------
INSERT INTO public.deals (
  id, listing_id, offer_id, buyer_org_id, supplier_org_id,
  agreed_price, agreed_quantity, agreed_unit, agreed_currency,
  agreed_delivery_date, agreed_incoterms, agreed_payment_terms, goods_description,
  status, deal_source, total_value, shipping_cost,
  agreed_at, confirmed_at, in_preparation_at, shipped_at,
  shipment_tracking_ref, shipment_carrier, shipment_estimated_delivery,
  contract_submitted_at, contract_submitted_by,
  contract_supplier_signature, contract_supplier_signed_at,
  payment_instructions_set_at, payment_instructions_set_by,
  payment_confirmed_at, payment_confirmed_by, payment_amount, payment_currency, payment_external_reference,
  payment_due_date, completed_at,
  created_at, updated_at
)
VALUES (
  'de700000-0000-0000-0000-000000000001',
  'de600000-0000-0000-0000-000000000005', NULL,
  'de200000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000002',
  223500, 300, 'MT', 'USD',
  (now() - interval '10 days')::date, 'FOB', 'Net 60',
  '300 MT of ASTM A36 structural steel angle bar (3in x 3in x 3/8in) for retail fixture and shelving fabrication',
  'completed', 'marketplace', 223500, 8400,
  now() - interval '27 days', now() - interval '25 days', now() - interval '24 days', now() - interval '17 days',
  'IBS-48213-FR', 'Freight Dynamics LLC', (now() - interval '10 days')::date,
  now() - interval '26 days', 'de000000-0000-0000-0000-000000000001',
  'Dana Reyes, CFO — Ironbridge Steel Works, Inc.', now() - interval '25 days',
  now() - interval '9 days', 'de000000-0000-0000-0000-000000000002',
  now() - interval '6 days', 'de000000-0000-0000-0000-000000000001', 223500, 'USD', 'WIRE-20260706-8842',
  (now() - interval '25 days' + interval '60 days')::date, now() - interval '5 days',
  now() - interval '35 days', now() - interval '5 days'
)
ON CONFLICT (id) DO NOTHING;

-- Backfill the matched listing's matched_deal_id now that the deal row exists
-- (fk_matched_deal requires the deal to already be present).
UPDATE public.marketplace_listings
SET matched_deal_id = 'de700000-0000-0000-0000-000000000001'
WHERE id = 'de600000-0000-0000-0000-000000000005'
  AND matched_deal_id IS NULL;

-- ---------------------------------------------------------------------------
-- 10. Deal events — full negotiation + lifecycle narrative for the deal above
-- ---------------------------------------------------------------------------
INSERT INTO public.deal_events (id, deal_id, event_type, actor_user_id, actor_org_id, description, metadata, created_at)
VALUES
  ('de710000-0000-0000-0000-000000000001', 'de700000-0000-0000-0000-000000000001', 'negotiation_offer_submitted', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Harborview Retail submitted an opening offer of $205,000 for 300 MT of ASTM A36 structural steel angle bar (FOB, Net 60).',
   '{"offered_price":205000,"round":1}'::jsonb, now() - interval '35 days'),
  ('de710000-0000-0000-0000-000000000002', 'de700000-0000-0000-0000-000000000001', 'negotiation_countered', NULL, 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works countered at $232,000, citing current hot-rolled coil index pricing.',
   '{"offered_price":232000,"round":2}'::jsonb, now() - interval '33 days'),
  ('de710000-0000-0000-0000-000000000003', 'de700000-0000-0000-0000-000000000001', 'negotiation_countered', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Harborview Retail countered at $214,000.',
   '{"offered_price":214000,"round":3}'::jsonb, now() - interval '31 days'),
  ('de710000-0000-0000-0000-000000000004', 'de700000-0000-0000-0000-000000000001', 'negotiation_countered', NULL, 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works countered at $223,500, noted as their floor price.',
   '{"offered_price":223500,"round":4}'::jsonb, now() - interval '29 days'),
  ('de710000-0000-0000-0000-000000000005', 'de700000-0000-0000-0000-000000000001', 'negotiation_accepted', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Harborview Retail accepted Ironbridge Steel Works'' terms: $223,500 for 300 MT, FOB, Net 60. Deal agreed.',
   '{"agreed_price":223500,"agreed_incoterms":"FOB","agreed_payment_terms":"Net 60"}'::jsonb, now() - interval '27 days'),
  ('de710000-0000-0000-0000-000000000006', 'de700000-0000-0000-0000-000000000001', 'contract_submitted', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Harborview Retail submitted the AI-generated trade contract for signature.', NULL, now() - interval '26 days'),
  ('de710000-0000-0000-0000-000000000007', 'de700000-0000-0000-0000-000000000001', 'contract_signed', 'de000000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works signed the trade contract. Commercial invoice generated.', NULL, now() - interval '25 days'),
  ('de710000-0000-0000-0000-000000000008', 'de700000-0000-0000-0000-000000000001', 'in_preparation', NULL, 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works began production and staged the order for shipment.', NULL, now() - interval '24 days'),
  ('de710000-0000-0000-0000-000000000009', 'de700000-0000-0000-0000-000000000001', 'shipped', 'de000000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002',
   'Shipment dispatched via Freight Dynamics LLC, tracking IBS-48213-FR. Estimated delivery in 7 days.',
   '{"tracking_ref":"IBS-48213-FR","carrier":"Freight Dynamics LLC"}'::jsonb, now() - interval '17 days'),
  ('de710000-0000-0000-0000-000000000010', 'de700000-0000-0000-0000-000000000001', 'delivery_confirmed', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Harborview Retail confirmed delivery at the Dallas distribution center.', NULL, now() - interval '10 days'),
  ('de710000-0000-0000-0000-000000000011', 'de700000-0000-0000-0000-000000000001', 'payment_instructions_set', 'de000000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works provided receiving bank account details for payment.', NULL, now() - interval '9 days'),
  ('de710000-0000-0000-0000-000000000012', 'de700000-0000-0000-0000-000000000001', 'payment_confirmed', 'de000000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'Payment of $223,500 confirmed sent via wire (ref WIRE-20260706-8842), well ahead of the Net 60 due date.',
   '{"payment_amount":223500,"payment_reference":"WIRE-20260706-8842"}'::jsonb, now() - interval '6 days'),
  ('de710000-0000-0000-0000-000000000013', 'de700000-0000-0000-0000-000000000001', 'completed', NULL, 'de200000-0000-0000-0000-000000000002',
   'Ironbridge Steel Works confirmed receipt of funds. Deal marked completed — 30-day cycle from first offer to payment.', NULL, now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Agent actions — the AI audit-log side of the same negotiation
--     (action_type values verified live: negotiation_offer_submitted,
--     negotiation_countered, negotiation_accepted all exist on
--     agent_action_type as of migration 024/032).
-- ---------------------------------------------------------------------------
INSERT INTO public.agent_actions (
  id, org_id, action_type, entity_type, entity_id,
  reasoning, input_summary, output_summary, outcome,
  requires_approval, human_approved, approved_by_user_id, approved_at, model, created_at
)
VALUES
  ('de720000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'negotiation_offer_submitted', 'deal', 'de700000-0000-0000-0000-000000000001',
   'Buyer agent opened negotiation on Ironbridge''s Structural Steel Angle Bar listing after ERP flagged a projected shortfall in steel racking inventory (SKU-84512-STLRACK, 298 units projected vs 1,200 reserved).',
   'listing_id=de600000-0000-0000-0000-000000000005; requested 300 MT ASTM A36 angle bar; opening offer $205,000 FOB; payment terms Net 60',
   'Offer submitted to Ironbridge Steel Works at $205,000 (~$683/MT), 16% below listed target price.',
   'success', true, true, 'de000000-0000-0000-0000-000000000001', now() - interval '35 days', 'claude-haiku-4-5-20251001', now() - interval '35 days'),

  ('de720000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000002', 'negotiation_countered', 'deal', 'de700000-0000-0000-0000-000000000001',
   'Listing-defense agent evaluated the opening offer against current mill index pricing and countered above the buyer''s number while staying within the standing price floor.',
   'Incoming offer $205,000 for 300 MT',
   'Countered at $232,000 (~$773/MT), citing current hot-rolled coil index and processing costs.',
   'success', false, NULL, NULL, NULL, 'claude-haiku-4-5-20251001', now() - interval '33 days'),

  ('de720000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000001', 'negotiation_countered', 'deal', 'de700000-0000-0000-0000-000000000001',
   'Buyer agent countered within its configured price ceiling, leaving room to converge.',
   'Supplier counter $232,000',
   'Countered at $214,000 (~$713/MT).',
   'success', false, NULL, NULL, NULL, 'claude-haiku-4-5-20251001', now() - interval '31 days'),

  ('de720000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000002', 'negotiation_countered', 'deal', 'de700000-0000-0000-0000-000000000001',
   'Supplier agent held close to its floor, offering a modest concession to keep the deal moving toward close.',
   'Buyer counter $214,000',
   'Countered at $223,500 (~$745/MT), flagged internally as at floor.',
   'success', false, NULL, NULL, NULL, 'claude-haiku-4-5-20251001', now() - interval '29 days'),

  ('de720000-0000-0000-0000-000000000005', 'de200000-0000-0000-0000-000000000001', 'negotiation_accepted', 'deal', 'de700000-0000-0000-0000-000000000001',
   'Terms landed within guardrails; escalated to GATE 2 for human finalization before acceptance executed.',
   'Ironbridge counter $223,500, FOB, Net 60',
   'Jordan Blake (Harborview Retail) approved finalization at $223,500. Deal created.',
   'success', true, true, 'de000000-0000-0000-0000-000000000001', now() - interval '27 days', 'claude-haiku-4-5-20251001', now() - interval '27 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. ERP connection — Harborview Retail (ERPNext), active
-- NOTE: must be 'erpnext' or 'odoo' — these are the only two ERP types the
-- real app/api/erp/connect route accepts and the only two shown as
-- selectable (non-"Coming Soon") in Settings -> ERP Integration. Originally
-- seeded as 'netsuite', which the real Settings UI shows as a disabled
-- "Coming Soon" provider — fixed so the demo tour's ERP scene shows a
-- genuinely live, non-disabled connector, not a fake state on a real page.
-- ---------------------------------------------------------------------------
INSERT INTO public.erp_connections (
  id, org_id, erp_type, base_url, api_key, api_secret, status, last_synced_at, created_at, updated_at
)
VALUES (
  'de800000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'erpnext',
  'https://harborview.erpnext.com', 'demo_seed_netsuite_key_7f2a9c', 'demo_seed_netsuite_secret_b19e44',
  'active', now() - interval '3 hours', now() - interval '85 days', now() - interval '3 hours'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12b. Passport documents & certifications — Harborview Retail. Fake
-- storage_path values (no real file behind them): the passport documents API
-- (app/api/passport/[org_id]/documents/route.ts) calls createSignedUrl per
-- row and gracefully falls back to a null url on a miss, so the doc still
-- renders (name/date, "—" instead of a Download link) with nothing broken.
-- ---------------------------------------------------------------------------
INSERT INTO public.documents (
  id, org_id, entity_type, entity_id, document_kind, name, storage_path, file_size_bytes, mime_type, ai_extracted, created_at
)
VALUES
  ('de950000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'organization', 'de200000-0000-0000-0000-000000000001', 'passport_certification', 'ISO 9001-2015 Quality Management Certificate.pdf', 'demo/harborview-iso-9001-2015.pdf', 412000, 'application/pdf', false, now() - interval '140 days'),
  ('de950000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001', 'organization', 'de200000-0000-0000-0000-000000000001', 'passport_certification', 'SOC 2 Type II Report.pdf', 'demo/harborview-soc2-type2.pdf', 861000, 'application/pdf', false, now() - interval '95 days'),
  ('de950000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000001', 'organization', 'de200000-0000-0000-0000-000000000001', 'passport_document', 'Certificate of Incorporation.pdf', 'demo/harborview-certificate-of-incorporation.pdf', 188000, 'application/pdf', false, now() - interval '210 days'),
  ('de950000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000001', 'organization', 'de200000-0000-0000-0000-000000000001', 'passport_document', 'W-9 Tax Form.pdf', 'demo/harborview-w9.pdf', 94000, 'application/pdf', false, now() - interval '180 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. ERP sync data — cash position, AR/AP aging, inventory, open orders.
--     inventory_levels flags a projected shortfall on a steel racking SKU —
--     the "ERP found a problem" hook that pairs with the Ironbridge steel
--     listings above (search_marketplace_listings keyword-matches "steel").
--     JSON shapes match app/api/erp/sync/route.ts's sync* functions exactly
--     (verified by reading the live route source, not guessed).
-- ---------------------------------------------------------------------------
INSERT INTO public.erp_sync_data (id, org_id, erp_connection_id, data_type, data, fetched_at)
VALUES
  ('de810000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'de800000-0000-0000-0000-000000000001', 'cash_position',
   jsonb_build_object(
     'net_cash', 4820000,
     'entry_count', 812,
     'as_of', to_char(now() - interval '1 day', 'YYYY-MM-DD')
   ),
   now() - interval '3 hours'),

  ('de810000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001', 'de800000-0000-0000-0000-000000000001', 'ar_aging',
   jsonb_build_object(
     'total_outstanding', 2857500,
     'invoice_count', 214,
     'buckets', jsonb_build_object('current', 1840000, 'days_1_30', 610000, 'days_31_60', 275000, 'days_61_90', 90000, 'over_90', 42500),
     'currency', 'USD',
     'invoices', jsonb_build_array(
       jsonb_build_object('name', 'INV-88213', 'customer', 'Fairmont Retail Partners', 'outstanding_amount', 18500, 'due_date', to_char(now() - interval '100 days', 'YYYY-MM-DD'), 'currency', 'USD'),
       jsonb_build_object('name', 'INV-88240', 'customer', 'Union Square Franchise Group', 'outstanding_amount', 24000, 'due_date', to_char(now() - interval '95 days', 'YYYY-MM-DD'), 'currency', 'USD'),
       jsonb_build_object('name', 'INV-88301', 'customer', 'Lakeside Commerce LLC', 'outstanding_amount', 42500, 'due_date', to_char(now() - interval '132 days', 'YYYY-MM-DD'), 'currency', 'USD')
     )
   ),
   now() - interval '3 hours'),

  ('de810000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000001', 'de800000-0000-0000-0000-000000000001', 'ap_aging',
   jsonb_build_object(
     'total_outstanding', 1232000,
     'invoice_count', 47,
     'buckets', jsonb_build_object('current', 620000, 'days_1_30', 310000, 'days_31_60', 185000, 'days_61_90', 96000, 'over_90', 21000),
     'currency', 'USD'
   ),
   now() - interval '3 hours'),

  ('de810000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000001', 'de800000-0000-0000-0000-000000000001', 'inventory_levels',
   jsonb_build_object(
     'total_sku_count', 1486,
     'low_stock_count', 3,
     'low_stock_items', jsonb_build_array(
       jsonb_build_object('item_code', 'SKU-84512-STLRACK', 'warehouse', 'DAL-DC1', 'actual_qty', 340, 'reserved_qty', 1200, 'projected_qty', 298, 'valuation_rate', 62.50),
       jsonb_build_object('item_code', 'SKU-77310-CORRBOX', 'warehouse', 'DAL-DC1', 'actual_qty', 5400, 'reserved_qty', 15800, 'projected_qty', 5100, 'valuation_rate', 0.58),
       jsonb_build_object('item_code', 'SKU-91002-PCBCTRL', 'warehouse', 'AUS-DC3', 'actual_qty', 220, 'reserved_qty', 900, 'projected_qty', 205, 'valuation_rate', 41.20)
     ),
     'bins', jsonb_build_array(
       jsonb_build_object('item_code', 'SKU-84512-STLRACK', 'warehouse', 'DAL-DC1', 'actual_qty', 340, 'reserved_qty', 1200, 'projected_qty', 298, 'valuation_rate', 62.50),
       jsonb_build_object('item_code', 'SKU-77310-CORRBOX', 'warehouse', 'DAL-DC1', 'actual_qty', 5400, 'reserved_qty', 15800, 'projected_qty', 5100, 'valuation_rate', 0.58),
       jsonb_build_object('item_code', 'SKU-91002-PCBCTRL', 'warehouse', 'AUS-DC3', 'actual_qty', 220, 'reserved_qty', 900, 'projected_qty', 205, 'valuation_rate', 41.20),
       jsonb_build_object('item_code', 'SKU-10044-TSHIRT', 'warehouse', 'DAL-DC1', 'actual_qty', 48000, 'reserved_qty', 12000, 'projected_qty', 44000, 'valuation_rate', 3.10),
       jsonb_build_object('item_code', 'SKU-33210-LEDBULB', 'warehouse', 'DAL-DC1', 'actual_qty', 22000, 'reserved_qty', 6000, 'projected_qty', 20500, 'valuation_rate', 2.85)
     )
   ),
   now() - interval '3 hours'),

  ('de810000-0000-0000-0000-000000000005', 'de200000-0000-0000-0000-000000000001', 'de800000-0000-0000-0000-000000000001', 'open_orders',
   jsonb_build_object(
     'open_sales_orders', 132,
     'open_purchase_orders', 18,
     'sales_order_total', 3410000,
     'purchase_order_total', 968000,
     'sales_orders', jsonb_build_array(
       jsonb_build_object('name', 'SO-90112', 'customer', 'Fairmont Retail Partners', 'grand_total', 58200, 'currency', 'USD', 'transaction_date', to_char(now() - interval '6 days', 'YYYY-MM-DD'), 'delivery_date', to_char(now() + interval '9 days', 'YYYY-MM-DD'), 'status', 'To Deliver'),
       jsonb_build_object('name', 'SO-90148', 'customer', 'Union Square Franchise Group', 'grand_total', 41500, 'currency', 'USD', 'transaction_date', to_char(now() - interval '3 days', 'YYYY-MM-DD'), 'delivery_date', to_char(now() + interval '12 days', 'YYYY-MM-DD'), 'status', 'To Deliver')
     ),
     'purchase_orders', jsonb_build_array(
       jsonb_build_object('name', 'PO-55210', 'supplier', 'Ironbridge Steel Works', 'grand_total', 184000, 'currency', 'USD', 'transaction_date', to_char(now() - interval '12 days', 'YYYY-MM-DD'), 'schedule_date', to_char(now() + interval '18 days', 'YYYY-MM-DD'), 'status', 'To Receive'),
       jsonb_build_object('name', 'PO-55234', 'supplier', 'Cedarline Packaging Solutions', 'grand_total', 76500, 'currency', 'USD', 'transaction_date', to_char(now() - interval '5 days', 'YYYY-MM-DD'), 'schedule_date', to_char(now() + interval '25 days', 'YYYY-MM-DD'), 'status', 'To Receive')
     )
   ),
   now() - interval '3 hours')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Second deal, deliberately left un-financed and in a FINANCEABLE_STATUSES
-- status (see apps/web/lib/deals/transitions.ts — 'completed' is NOT financeable,
-- so the original Ironbridge deal above cannot power the Scene 3 financing demo
-- beat). This one (Harborview <- Cedarline, delivery_confirmed) is what the
-- demo choreography's financing scene points at.
-- ---------------------------------------------------------------------------
INSERT INTO deals (
  id, listing_id, buyer_org_id, supplier_org_id,
  agreed_price, agreed_quantity, agreed_unit, agreed_currency,
  agreed_delivery_date, agreed_incoterms, agreed_payment_terms,
  goods_description, status, deal_source, total_value,
  shipment_tracking_ref, shipment_carrier, shipment_estimated_delivery, shipped_at,
  confirmed_at, in_preparation_at, goods_received_at, goods_confirmed_at,
  counterparty_confirmed, counterparty_confirmed_at,
  agreed_at, created_at, updated_at
) VALUES (
  'de700000-0000-0000-0000-000000000002',
  'de600000-0000-0000-0000-000000000003',
  'de200000-0000-0000-0000-000000000001',
  'de200000-0000-0000-0000-000000000003',
  155000, 250000, 'units', 'USD',
  (now() - interval '3 days')::date, 'FOB', 'Net 30',
  'Corrugated Shipping Cartons — Custom Print, 250,000 Units',
  'delivery_confirmed', 'marketplace', 155000,
  'CPS-88214-TRK', 'FedEx Freight', (now() - interval '5 days')::date, now() - interval '10 days',
  now() - interval '9 days', now() - interval '9 days', now() - interval '4 days', now() - interval '3 days',
  true, now() - interval '9 days',
  now() - interval '14 days', now() - interval '14 days', now() - interval '3 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO deal_events (id, deal_id, event_type, actor_user_id, actor_org_id, description, created_at)
VALUES
  (gen_random_uuid(), 'de700000-0000-0000-0000-000000000002', 'agreed', NULL, 'de200000-0000-0000-0000-000000000003', 'Offer accepted at $155,000 for 250,000 units, FOB, Net 30.', now() - interval '14 days'),
  (gen_random_uuid(), 'de700000-0000-0000-0000-000000000002', 'shipped', NULL, 'de200000-0000-0000-0000-000000000003', 'Shipment dispatched via FedEx Freight, tracking CPS-88214-TRK.', now() - interval '10 days'),
  (gen_random_uuid(), 'de700000-0000-0000-0000-000000000002', 'delivery_confirmed', NULL, 'de200000-0000-0000-0000-000000000001', 'Buyer confirmed receipt of goods in full.', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- A real, live agent_tasks proposal card (GATE-1-style, awaiting_approval) for
-- the demo org. This is what the demo choreography's "capital optimization"
-- scene points at — an actual proposal the prospect can revise/approve on the
-- real /ai Agent tab, not a fabricated UI element.
-- ---------------------------------------------------------------------------
INSERT INTO agent_tasks (id, org_id, type, title, body, proposed_action, status, created_at, updated_at)
VALUES (
  'de900000-0000-0000-0000-000000000001',
  'de200000-0000-0000-0000-000000000001',
  'scan_advisory',
  'Lock in additional steel capacity from Ironbridge ahead of Q4',
  'Your ERP shows steel racking inventory (SKU-84512-STLRACK) running low with 1,200 units already reserved against 340 on hand, and Ironbridge Steel Works has been a reliable, well-priced counterparty on your last completed deal. Proposing a follow-on offer on their open "Hot-Rolled Steel Coils — Grade A36, 500 MT" listing at $365,000 (below their $390,000 ask) to lock in current pricing before Q4 demand pushes it higher.',
  jsonb_build_object(
    'tool_name', 'submit_marketplace_offer',
    'tool_input', jsonb_build_object(
      'listing_id', 'de600000-0000-0000-0000-000000000001',
      'from_org_id', 'de200000-0000-0000-0000-000000000001',
      'offered_price', 365000,
      'offered_quantity', 500,
      'message', 'Building on our successful engagement with Ironbridge — proposing to lock in pricing ahead of Q4 demand.'
    )
  ),
  'awaiting_approval',
  now() - interval '2 hours', now() - interval '2 hours'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- A real Strike Room narrating the Ironbridge negotiation (same underlying
-- deal as de700000-...-001) as genuine ai_suggestion messages, mirroring the
-- real agent_actions rows above — this is what the demo tour's Strike Rooms
-- scene points at ("the human view" of a negotiation).
-- ---------------------------------------------------------------------------
INSERT INTO rooms (
  id, room_type, status, name, description, category,
  created_by_org_id, created_by_user_id, deal_id,
  is_moderated, participant_count, message_count, last_message_at,
  created_at, updated_at
) VALUES (
  'dea00000-0000-0000-0000-000000000001', 'private', 'active',
  'Structural Steel Angle Bar — Deal Room',
  'Negotiation room for the 300 MT ASTM A36 structural steel angle bar deal between Harborview Retail Group and Ironbridge Steel Works.',
  'Steel Trading',
  'de200000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001',
  'de700000-0000-0000-0000-000000000001',
  true, 2, 6, now() - interval '27 days',
  now() - interval '28 days', now() - interval '27 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_participants (id, room_id, org_id, user_id, role, joined_at)
VALUES
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', 'owner', now() - interval '28 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-000000000002', 'participant', now() - interval '28 days')
ON CONFLICT DO NOTHING;

INSERT INTO room_messages (id, room_id, user_id, org_id, content, message_type, status, created_at)
VALUES
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, 'de200000-0000-0000-0000-000000000001',
   'Opened negotiation on Ironbridge''s Structural Steel Angle Bar listing — ERP flagged a projected shortfall in steel racking inventory (SKU-84512-STLRACK). Opening offer: $205,000, FOB, Net 60.',
   'ai_suggestion', 'visible', now() - interval '28 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, 'de200000-0000-0000-0000-000000000002',
   'Countered at $232,000 (~$773/MT), based on current hot-rolled coil index and processing costs.',
   'ai_suggestion', 'visible', now() - interval '26 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, 'de200000-0000-0000-0000-000000000001',
   'Countered at $214,000 (~$713/MT), within our configured price ceiling.',
   'ai_suggestion', 'visible', now() - interval '24 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, 'de200000-0000-0000-0000-000000000002',
   'Countered at $223,500 (~$745/MT) — at our floor, but keeping this deal moving toward close.',
   'ai_suggestion', 'visible', now() - interval '22 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, 'de200000-0000-0000-0000-000000000001',
   'Terms landed within guardrails — escalating to Jordan Blake for final approval before accepting.',
   'ai_suggestion', 'visible', now() - interval '20 days'),
  (gen_random_uuid(), 'dea00000-0000-0000-0000-000000000001', NULL, NULL,
   'Deal agreed. Both parties have confirmed terms: $223,500, FOB, Net 60.',
   'system', 'visible', now() - interval '20 days')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- AI expert Passport analysis for Harborview (matches passport_score=84 set
-- above). Without this, app/(portal)/passport/page.tsx's ScoreBreakdownCard
-- never renders (falls back to a "run analysis" placeholder instead) — the
-- demo tour's Passport scene needs the real 4-dimension breakdown to exist.
-- NOTE: the column is jsonb but the frontend does JSON.parse(org.
-- passport_expert_analysis) expecting a STRING — Supabase returns a jsonb
-- object value already-parsed, so JSON.parse() on it silently fails (caught,
-- returns null). Must double-encode: wrap the built object in
-- to_jsonb((...)::text) so the stored jsonb value is itself a JSON string.
-- ---------------------------------------------------------------------------
UPDATE organizations
SET passport_expert_analysis = to_jsonb((jsonb_build_object(
  'scores', jsonb_build_object(
    'kyb_compliance', jsonb_build_object(
      'score', 22,
      'reasoning', 'KYB fully submitted and verified — EIN, incorporation documents, and beneficial ownership all confirmed with no outstanding items.',
      'document_findings', jsonb_build_array('Certificate of incorporation verified', 'EIN confirmed via IRS match'),
      'missing_docs', jsonb_build_array()
    ),
    'financial_health', jsonb_build_object(
      'score', 20,
      'reasoning', 'Strong revenue scale and healthy cash position relative to trade volume, with no adverse credit signals on file.',
      'key_metrics', jsonb_build_object('annual_revenue_range', '$100M-$500M', 'cash_position', '$620,000')
    ),
    'trade_reliability', jsonb_build_object(
      'score', 21,
      'reasoning', 'One completed deal on platform with on-time payment and no disputes; limited trade history caps the score slightly below maximum.',
      'document_findings', jsonb_build_array()
    ),
    'network_reputation', jsonb_build_object(
      'score', 21,
      'reasoning', 'No peer reviews yet, but strong counterparty engagement and a clean negotiation history support a solid reputation baseline.'
    )
  ),
  'total_score', 84,
  'risk_tier', 'green',
  'executive_summary', 'Harborview Retail Group presents a strong, low-risk profile with complete KYB documentation, healthy financials, and a clean early trade history. The score reflects genuine platform activity rather than a default baseline.',
  'key_strengths', jsonb_build_array('Fully verified KYB with no outstanding items', 'Healthy cash position relative to trade volume', 'Clean payment history on completed trades'),
  'risk_flags', jsonb_build_array(),
  'improvement_actions', jsonb_build_array('Complete additional trades to build a longer performance track record', 'Request peer reviews from counterparties after deal completion'),
  'document_quality', 'complete',
  'analyst_confidence', 'high',
  'analyst_notes', 'Score reflects verified documentation and real trade activity as of this review; will continue to strengthen as trade volume grows.',
  'documents_analyzed', jsonb_build_array('Certificate of Incorporation', 'EIN Confirmation Letter', 'Bank Account Verification')
))::text),
passport_ai_evaluated_at = now() - interval '2 hours'
WHERE id = 'de200000-0000-0000-0000-000000000001';
