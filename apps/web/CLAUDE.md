# Strike SCF — Claude Code Project Guide

> Read this file completely before touching any code. It is your map.

---

## What this project is

Strike SCF is a **Supply Chain Finance (SCF) platform** for three distinct user types:
- **Banks** — create programs, review KYB, make credit decisions, approve financing, monitor risk
- **Anchors** (large buyers like Pacific Dynamics) — invite suppliers, approve invoices
- **Suppliers** (SMBs like Westcoast Fabricators) — submit invoices for early payment

The same Next.js app serves all three portals. Portal type is derived from `users.role` at login and stored in `PortalContext`.

---

## Monorepo structure

```
strike-scf/
└── my-turborepo/
    ├── apps/
    │   ├── web/          ← MAIN APP — almost everything you touch is here
    │   └── docs/         ← Marketing/docs site — rarely touch
    ├── packages/
    │   ├── types/        ← Shared TypeScript types (index.ts)
    │   ├── ui/           ← Shared UI primitives (rarely used — app has its own)
    │   ├── eslint-config/
    │   └── typescript-config/
    └── supabase/
        └── seed.sql      ← Dev seed data
```

**Always work inside `apps/web/` unless told otherwise.**

---

## apps/web directory map

```
apps/web/
├── app/
│   ├── (auth)/           ← Login, signup, forgot-password, invite, reset-password
│   ├── (onboarding)/     ← Supplier/anchor onboarding wizard
│   ├── (portal)/         ← ALL authenticated portal pages
│   │   ├── layout.tsx    ← Auth check + PortalProvider + UserProvider + PortalShell
│   │   ├── portal-shell.tsx ← Sidebar + main + AIOverlay (Strike AI)
│   │   ├── dashboard/    ← Role-aware dashboard (bank/buyer/supplier/admin views)
│   │   ├── ai/           ← STRIKE AI — dedicated agent page (chat + history + doc gen)
│   │   │
│   │   ├── marketplace/  ← STRIKE PLACE — listings + offers hub
│   │   │   ├── financing/[id]/   ← Financing requests (bank "Strike Place" view)
│   │   │   └── listings/{new,[id]} ← Create / view a listing
│   │   ├── deals/        ← MY DEALS — deal lifecycle (deal_source: marketplace|imported|direct)
│   │   │   ├── [id]/             ← Deal detail (AI doc gen on status → 'agreed')
│   │   │   └── import/           ← Import a pre-existing deal
│   │   ├── rooms/        ← STRIKE ROOMS — realtime negotiation rooms
│   │   │   └── [id]/             ← Room thread (messages + AI moderation)
│   │   ├── passport/     ← MY PASSPORT / PassportScore (network trust score)
│   │   │   ├── [org_id]/         ← Public passport profile
│   │   │   └── review/[org_id]/  ← Submit a peer review
│   │   ├── networks/     ← Anchor Supplier Networks (anchor creates/manages; supplier sees memberships)
│   │   │   └── [id]/             ← Network detail (anchor: member management; supplier: read-only)
│   │   ├── supply-graph/ ← Supply Graph — "Coming Soon" full-page card (bank portal)
│   │   ├── admin/        ← STRIKE ADMIN (strike_admin role only)
│   │   │
│   │   ├── programs/     ← Program list, detail, new program wizard
│   │   │   ├── [id]/anchor/[anchor_id]/  ← Bank anchor drilldown
│   │   │   │   └── supplier/[supplier_id]/  ← Bank anchor→supplier drilldown
│   │   │   └── [id]/supplier/[supplier_id]/ ← Bank supplier drilldown
│   │   ├── transactions/ ← Transaction list, detail ([id]), new wizard (pages remain; no sidebar link)
│   │   ├── kyb/          ← KYB review — Strike Admin queue + per-org; bank view is read-only (no sidebar link for bank)
│   │   ├── collateral/   ← Collateral requirements management
│   │   ├── reporting/    ← Analytics & reporting
│   │   └── settings/     ← Profile, bank settings, team/, agent/ (AI Agent prefs; no sidebar link)
│   └── api/              ← Route groups: admin, ai, auth, collateral, dashboard,
│   │                       deals, documents, email, graph, invitations, kyb,
│   │                       marketplace, networks, notifications, onboarding,
│   │                       organizations, passport, performance, programs,
│   │                       recommendations, reporting, risk, rooms, settings,
│   │                       transactions
├── components/           ← Shared UI components
│   ├── sidebar.tsx               ← Role-aware sidebar (collapse to icon-only, localStorage key strike_sidebar_collapsed)
│   ├── portal-shell.tsx          ← Sidebar + main layout + AIOverlay
│   ├── topbar.tsx                ← Page topbar
│   ├── ghost-gate.tsx            ← GhostGate: wraps all portal children in (portal)/layout.tsx; locks ghost orgs
│   ├── ghost-lock.tsx            ← GhostLock: the locked-state card shown inside ghost-gated pages
│   ├── deals/ActionPanel.tsx     ← Deal action buttons (receives FinancingContext as props)
│   ├── deals/DealRoadmap.tsx     ← Deal timeline/roadmap (receives FinancingContext as props; steps: Agreed → Contract → In Business → Shipped → Received → Accepted → Paid → Completed)
│   ├── deals/FinancingManagementCard.tsx ← Financing-request lifecycle UI (contract sign → disbursement → confirm receipt); prop-driven, no internal fetching; shared by marketplace/financing/[id] (requester view) and deals/[id] (bank view). Bank's AI-generate contract path is preview-before-send (generate → review full text → "Send to Borrower"/"Discard & Regenerate"), mirroring the buyer/supplier trade-contract flow in ActionPanel.tsx — do not reintroduce an immediate generate-and-submit path.
│   ├── motion.tsx                ← `CountUp`/`Reveal`/`Skeleton`/`SkeletonText`/`SkeletonCard` — see "Motion system" below
│   ├── ai-overlay.tsx            ← Global AI overlay (hover-pill + draggable cluster); mounted on every page except /ai;
│   │                                web search + get_financing_programs tools enabled; reads data-ai-context from DOM
│   ├── ai-insight-card.tsx       ← Contextual AI insight banner/compact/floating → /api/ai/insight
│   ├── ai-insight.tsx            ← Inline collapsible AI insight widget → /api/ai/chat
│   ├── ai-panel.tsx              ← DEPRECATED/ORPHANED — old sliding panel, replaced by ai-overlay.tsx
│   ├── strike-ai-panel.tsx       ← Collapsible right-side AI context panel (300px); reads page data-ai-context;
│   │                                localStorage key: strike-ai-panel-open; defined but not yet imported anywhere
│   ├── doc-generator.tsx         ← Document export (template picker + /api/ai/documents)
│   ├── bulk-invite-modal.tsx     ← Modal for bulk-inviting suppliers to a program
│   ├── create-program-flow.tsx   ← Multi-step program creation wizard component
│   ├── liquidity-routing.tsx     ← Liquidity routing component (deal financing flow)
│   ├── performance-scorecard.tsx ← Supplier performance scorecard display
│   ├── recommendations-panel.tsx ← AI recommendations panel
│   ├── passport-score-ring.tsx   ← PassportScore ring SVG component
│   ├── passport-sections.tsx     ← Passport profile section cards
│   ├── supply-graph.tsx          ← Supply graph network visualization
│   ├── risk-badge.tsx            ← Risk tier / score badge
│   ├── charts.tsx                ← Recharts-based chart components
│   └── email-template.tsx        ← Resend email HTML template
├── lib/                  ← Utilities, Supabase clients, contexts
└── reference/            ← Original design mockups (JSX/HTML) — design reference
```

> Sidebar nav is **role-aware & flat** (`components/sidebar.tsx`). Collapses to icon-only mode (56px width); persisted in localStorage `strike_sidebar_collapsed`. All labels below are what users currently see — removed items (Settings, AI Agent, My Programs, Transactions, KYB Review) still have pages but no sidebar link.
>
> **Strike AI** (`/ai`) is rendered as a special featured button at the **top** of the nav (above all other items) for all portals — blue→purple gradient pill with shimmer animation. It is NOT part of the `ANCHOR_NAV` / `SUPPLIER_NAV` / `BANK_NAV` / `ADMIN_NAV` arrays; it is hardcoded in the nav render above the `sections.map()` loop. Do not add it to the nav arrays.
>
> - **Anchor & Supplier** (identical): Strike AI (top) · Dashboard · Strike Place (`/marketplace`) · My Deals (`/deals`) · Financing (`/marketplace/financing`) · Networks (`/networks`) · Strike Rooms (`/rooms`) · Strike Passport (`/passport`) · Analytics (`/reporting`)
> - **Bank**: Strike AI (top) · Dashboard · Strike Place (`/marketplace/financing`) · Programs (`/programs`) · Strike Passport (`/passport`) · Reporting (`/reporting`) · Supply Graph (`/supply-graph`)
> - **Admin**: Strike AI (top) · Dashboard · KYB Queue (`/admin`) · Platform Stats (`/admin`) · Room Reports (`/admin`) · Strike Passport (`/passport`)

---

## Database schema (complete — source of truth)

RLS is enabled on all tables. Policies live in Supabase Studio. The admin client (service role) bypasses RLS — always add a manual scope filter when using it.

```
banks
  id, legal_name, display_name, institution_type, primary_contact_name,
  primary_contact_email, logo_url, website, routing_number,
  status (setup_pending|active|suspended), created_at, updated_at

organizations
  id, bank_id, type (anchor|supplier),
  status (invited|in_progress|submitted|under_review|
          approved_pending_collateral|approved_pending_signature|
          approved|rejected|suspended),
  legal_name, doing_business_as, ein, business_type,
  state_of_incorporation, address_line1, address_line2, city, state, zip,
  years_in_operation, annual_revenue_range, industry_naics,
  primary_contact_name, primary_contact_title, primary_contact_phone, primary_contact_email,
  bank_account_last4, bank_routing_number, bank_account_type (checking|savings),
  kyb_status (not_started|in_progress|submitted|under_review|
              more_info_requested|approved|rejected),
  kyb_submitted_at, credit_score, risk_tier (A|B|C|D),
  credit_reviewed_at, next_review_date,
  risk_score, risk_flags (jsonb array), tariff_exposure (jsonb),
  performance_score, performance_tier (preferred|standard|under_review),
  sourcing_countries (jsonb array), country_of_origin,
  network_visible (boolean),     -- v2: org opted into network/marketplace discovery
  passport_score (integer),      -- v2: cached PassportScore (0-100)
  invitation_id, created_at, updated_at

users
  id (= auth.users.id), email, full_name,
  role (bank_admin|bank_credit_officer|org_admin|org_member|strike_admin),
        -- v2: anchor_*/supplier_* roles are GONE; org.type decides buyer vs supplier
  bank_id, org_id, is_active, created_at, updated_at

programs
  id, bank_id, created_by_user_id, name,
  financing_types (array: factoring|reverse_factoring|po_financing|open),
  program_limit, per_supplier_sublimit, min_deal_size, max_deal_size,
  max_invoice_age_days, max_po_fulfillment_days,
  standard_tenor_days (default 60), currency (default 'USD'),
  is_open_account, status (draft|active|paused|closed),
  discount_schedule (jsonb), activated_at, created_at, updated_at

program_enrollments
  id, program_id, org_id, anchor_org_id, enrolled_by_user_id,
  status (invited|onboarding|active|suspended),
  suspension_reason, enrolled_at, created_at, updated_at

transactions
  id, program_id, bank_id, anchor_id, supplier_id, created_by_user_id,
  type (factoring|reverse_factoring|po_financing|open),
  anchor_initiated,
  status (draft|pending_anchor_initiation|pending_anchor_approval|
          pending_anchor_confirmation|pending_bank_review|more_info_requested|
          financing_approved_pending_collateral|financing_approved|funded|
          pending_delivery_confirmation|delivery_confirmed|repayment_due|
          completed|rejected|cancelled|in_dispute),
  invoice_number, invoice_date, invoice_due_date,
  po_number, po_date, expected_fulfillment_date, po_value,
  invoice_amount, financing_amount_requested, financing_amount_approved,
  financing_rate_apr, tenor_days,
  fee_amount, net_proceeds, actual_fee_amount,
  anchor_repayment_amount, repayment_due_date, original_due_date,
  requested_extension_days,
  discount_rate, discount_amount, early_payment_date,
  goods_services_description, rejection_reason, bank_approval_notes, supplier_notes,
  anchor_confirmed_at, anchor_confirmed_by_user_id,
  disbursed_at, disbursed_by_user_id, disbursement_reference,
  supplier_paid_at, repaid_at, repaid_by_user_id, repayment_reference,
  early_repayment,
  esign_document_id, esign_document_url,
  bank_signed_at, anchor_signed_at, supplier_signed_at, esign_completed_at,
  created_at, updated_at
  -- financing_request_id (FK → financing_requests) links a marketplace financing acceptance
  -- to its transaction row. The esign_* and disbursed_*/supplier_paid_at columns above are
  -- dual-purposed: legacy SCF program flow AND the marketplace financing-request contract/
  -- disbursement lifecycle (see "Two separate contract flows" below) — same columns, two callers.

transaction_events
  id, transaction_id, event_type, from_status, to_status,
  actor_id, actor_type, notes, metadata (jsonb), created_at

invitations
  id, email, role (anchor|supplier),
  invited_by_user_id, invited_by_actor_type (bank|anchor),
  bank_id, program_id, anchor_org_id, company_name_hint, invitee_name,
  token (unique hex), status (pending|accepted|expired|revoked),
  expires_at, accepted_at,
  invitation_mode (standard|known_counterparty|custom_kyb),
  required_documents (jsonb), prefilled_kyb (jsonb),
  created_at

documents
  id, name, storage_path, mime_type, size_bytes,
  uploaded_by_user_id, entity_type, entity_id,
  document_kind, created_at
  NOTE: single unified documents table — no separate kyb_documents or collateral tables

collateral_requirements
  id, level, org_id, transaction_id,
  required_by_user_id, collateral_type, description, required_value,
  deadline, status (pending|submitted|approved|rejected|waived|released),
  submitted_at, reviewed_at, reviewed_by_user_id,
  rejection_reason, waiver_note,
  released_at, released_by_user_id,
  created_at, updated_at

credit_scores
  id, org_id,
  score_business_longevity, score_revenue_scale, score_document_completeness,
  score_financial_health, score_program_fit, score_counterparty_tenure,
  total_score, risk_tier,
  financial_health_notes, created_at

credit_decision_records
  id, org_id, credit_score_id,
  decision (approved|override_approved|more_info_requested|
            rejected|pending_countersign),
  decided_by_user_id, decided_by_user_name,
  countersigned_by_user_id,
  score_at_decision, risk_tier_at_decision,
  override_reason, rejection_reason, info_request_message,
  created_at

supplier_performance
  id, org_id, bank_id,
  on_time_payment_rate, dispute_rate, financing_utilization_rate, avg_advance_rate,
  total_transactions, total_financed,
  performance_tier (preferred|standard|under_review), performance_score,
  last_calculated_at, created_at, updated_at

supply_graph_edges
  id, from_org_id, to_org_id, edge_type, program_id,
  transaction_count, total_volume, risk_weight, created_at

recommendations
  id, bank_id, org_id, transaction_id,
  priority (high|medium|low), category, title, body,
  action_label, action_url, estimated_impact,
  dismissed, actioned, created_at

bulk_invite_jobs
  id, program_id, anchor_org_id, created_by_user_id, bank_id,
  total_count, sent_count, failed_count,
  status (processing|completed|failed), errors (jsonb),
  created_at

market_signals
  id, signal_type, country_code, commodity,
  value, metadata (jsonb), source, fetched_at

ai_usage
  id, user_id, org_id, bank_id, feature (chat|insight|document|scoring),
  tokens_input, tokens_output, tokens_total, model, created_at

ai_limits
  id, scope (user|org|bank|global), scope_id,
  feature, daily_limit (default 100), monthly_limit (default 2000),
  created_at

notifications
  id, user_id, event, title, body, deep_link,
  read, read_at, email_sent, email_sent_at, created_at
```

### v2 tables (Strike Place / Deals / Rooms / Passport / Agent)

These exist in the live schema (confirmed 2026-06-06). Column lists are
abbreviated — query the table or the generated `packages/types/database.types.ts`
(Track 2) for the full set.

```
deals
  id, deal_source (enum: marketplace|imported|direct),
  status (enum — full list below), ...
  -- Operational columns added by migration 00000000000007:
  --   shipment_tracking_ref, shipment_carrier, shipment_estimated_delivery, shipped_at
  --   commercial_invoice_id, commercial_invoice_issued_at
  --   payment_bank_name, payment_account_number, payment_routing_number,
  --     payment_swift_iban, payment_account_name, payment_reference,
  --     payment_instructions_set_at, payment_instructions_set_by
  --   financing_payment_active (bool) — true when bank advance is active on this deal
  --   payment_confirmed_at, payment_confirmed_by, payment_amount,
  --     payment_currency, payment_external_reference
  --   payment_due_date, overdue_notified_at
  --   amendment_history (jsonb — AmendmentRecord[])
  --   external_counterparty_email/name/country
  --   cancelled_by, disputed_at, disputed_by, dispute_reason, dispute_category,
  --     dispute_resolved_at, dispute_resolved_by, dispute_resolution
  --   confirmed_at, in_preparation_at
  -- AI doc generation fires on status -> 'agreed'
  -- Financing-structure columns added by DEAL-FLOW migration:
  --   noa_document_id UUID, noa_generated_at, noa_sent_to_buyer_at,
  --     noa_acknowledged_at, noa_acknowledged_by — Invoice Factoring NOA
  --   po_financing_converted_at — PO Financing converts on shipment
  --   dd_offer_presented_at, dd_offer_accepted_at, dd_offer_declined_at — Dynamic Discounting
  -- Procurement-flow-v2 columns added by migration 00000000000011 (deal-level trade contract,
  -- distinct from the financing-request contract — see "Two separate contract flows" below):
  --   receiving_bank_account_id — FK → bank_accounts; supplier-selected on contract signature
  --   contract_document_id/generated_at/submitted_at/submitted_by — buyer-submitted trade contract
  --   contract_supplier_signature, contract_supplier_signed_at — supplier's e-signature
  --   deal_invoice_document_id/number/generated_at — AI commercial invoice, auto-generated on contract sign
  --   bank_contract_document_id/submitted_at/submitted_by — bank-submitted financing contract (deal-level)
  --   bank_contract_signature/signed_by/signed_at — either deal party signs the bank contract

deal_status enum values (all live):
  negotiating | agreed | contract_pending | documents_pending | confirmed | in_preparation
  shipped | delivery_confirmed | in_dispute | payment_due | payment_overdue
  payment_confirmed | completed | cancelled
  active | financing_requested | financing_active | disputed   ← legacy aliases, keep for compat
  -- contract_pending added by migration 011, positioned AFTER 'agreed': buyer submits trade
  -- contract while 'agreed' → 'contract_pending'; supplier signs → 'confirmed'.
  -- Deal roadmap UI (DealRoadmap.tsx) step order: Agreed → Contract → In Business (='confirmed')
  -- → Shipped → Received → Accepted → Paid → Completed (old standalone "Pay Info" step removed).

deal_events                 -- audit log for deal lifecycle events (created by migration 007)
  id, deal_id, event_type, actor_user_id, actor_org_id, description, metadata, created_at
  RLS: org members can read events for deals they are party to

marketplace_listings        -- Strike Place product/PO listings
                            -- visibility (public|network_only), network_id FK → anchor_networks
listing_line_items          -- per-listing goods line items (added by migration 011); AI-extracted
                            -- via /api/marketplace/listings/extract (Haiku; PDF/image/DOCX/DOC/TXT/CSV)
                            -- or entered manually; CRUD via /api/marketplace/listings/[id]/line-items[/[itemId]]
marketplace_offers          -- offers on listings (realtime-subscribed)
                            -- bank_account_id, offer_items (jsonb) added by migration 011 — lets an
                            -- offering bank attach its own receiving account + itemized pricing
financing_requests          -- marketplace financing requests (preset|custom|open)
                            -- visibility (public|network_only), network_id FK → anchor_networks
financing_request_offers    -- bank offers on financing requests (realtime-subscribed)

anchor_networks             -- anchor-owned supplier networks; id, anchor_org_id, name, visibility_default, member_count
anchor_network_members      -- supplier memberships; status: invited|active|declined|suspended|removed
                            -- UNIQUE(network_id, supplier_org_id); anchor sees all members, suppliers see only own row
network_invite_tokens       -- one-time invite links for new (not-yet-on-Strike) suppliers; expires in 30 days

rooms                       -- Strike Rooms (private deal rooms + public)
room_participants           -- room_id, org_id, bank_id, user_id, role, joined_at, last_read_at
room_messages               -- realtime-subscribed; AI moderation on send
room_reports                -- room_id, message_id, reported_by_user_id, reason, resolved, resolution

passport_peer_reviews       -- peer reviews (NOT 'passport_reviews')
passport_views              -- viewer_org_id, viewer_bank_id, viewed_org_id, context

agent_actions               -- THE AI action/audit log (use this; do NOT create ai_actions_log).
                            -- action_type (enum — extended by migration 024 with negotiation_*
                            --   values + create_marketplace_listing/create_financing_request/
                            --   submit_marketplace_offer), entity_type, entity_id, reasoning,
                            --   input_summary, output_summary, outcome, requires_approval,
                            --   human_approved, approved_by_user_id, approved_at, model, tokens_used
agent_preferences           -- org-level AI hard limits/rules: org_id, preference_type,
                            -- value(jsonb), label, is_active, set_by_user_id
                            -- Loaded via lib/ai/agent-preferences.ts (getAgentPreferences(orgId)),
                            -- used both to bound what agent-scan.ts proposes and as the enforced
                            -- guardrails in the tick loop.
ai_negotiation_state        -- CONFIRMED ORPHANED — zero reads/writes anywhere in the app. Do not
                            -- use; `agent_negotiations` (below) is the real table for this.

-- ── Autonomous Agent Manager + Two-Gate Negotiation (see dedicated section below) ──
org_agents                  -- one per org, opt-in; id, org_id(unique), name, persona, is_active,
                            -- goals(jsonb), created_at, updated_at. Toggled via /api/agents/activate.
agent_tasks                 -- the single "human decision" record — root of a negotiation thread
                            -- OR a single-shot proposal. id, org_id, type, title, body,
                            -- proposed_action(jsonb: {tool_name, tool_input}),
                            -- status (awaiting_approval|approved|executing|rejected|completed|failed),
                            -- result(jsonb), approved_by_user_id, approved_at, rejected_reason,
                            -- plan(jsonb — negotiation-capable proposals only: {price_floor,
                            --   price_ceiling, max_rounds, deadline_at, guardrails_configured,
                            --   preferences_snapshot}; NULL for single-shot proposals),
                            -- root_task_id (FK → agent_tasks.id; NULL if this task IS the thread
                            --   root; follow-ups — negotiation_escalation, negotiation_ready_to_finalize —
                            --   always point back at the GATE-1 task that started the thread)
agent_negotiations          -- the stateful negotiation *process* that runs after GATE 1 is approved,
                            -- deliberately kept separate from agent_tasks. id, agent_task_id, org_id,
                            -- listing_id, offer_id (UNIQUE, nullable), deal_id (set once a deal exists),
                            -- status (active|awaiting_finalization|halted_by_user|halted_guardrail|
                            --   completed_accepted|completed_rejected|completed_withdrawn|
                            --   completed_deadline|failed), current_round, last_seen_offer_round,
                            -- last_tick_at (idempotency — see tick loop below), history(jsonb array),
                            -- halt_requested/halt_requested_by (the "Stop negotiation" button), outcome_summary
agent_task_messages         -- per-thread chat log. agent_task_id ALWAYS points at the thread's ROOT
                            -- task (never a follow-up task's own id), so reading a thread is one
                            -- simple query regardless of how many agent_tasks rows it has produced.
                            -- id, agent_task_id, role(user|assistant|system), content, created_at

-- ── ERP integration (REAL, live connectors — not a stub) ──────────────────────
erp_connections              -- one per org (UNIQUE org_id). erp_type (erpnext|netsuite|sap|oracle|
                            -- dynamics|odoo), base_url, api_key, api_secret, dispatch_token,
                            -- status (pending|active|error|disconnected), last_synced_at, error_message
erp_sync_data                -- UNIQUE(org_id, data_type). data_type (cash_position|ar_aging|ap_aging|
                            -- inventory_levels|open_orders|payment_terms|production_capacity),
                            -- period_start/end, data(jsonb — shape varies per data_type), fetched_at
```

> `ai_signals` / `ai_signal_resolutions` genuinely do not exist anywhere in the schema or codebase
> (confirmed via grep) — still just an idea, not built. Do NOT confuse this with `erp_connections`/
> `erp_sync_data`, which ARE fully built and live (migrations 018/019) — an earlier version of this
> file incorrectly listed those as "not yet in schema" too.

bank_accounts
  id, entity_type (bank|organization), entity_id (FK → banks.id or organizations.id),
  nickname, bank_name, account_holder_name,
  account_number (stored full; display last 4 only),
  routing_number, swift_iban (optional),
  account_type (checking|savings), is_primary (bool),
  created_at, updated_at
  RLS: org_admin/org_member read own org; org_admin write; bank_admin/credit_officer read own bank; bank_admin write; strike_admin read-all
  API: GET/POST /api/settings/bank-accounts, PATCH/DELETE /api/settings/bank-accounts/[id]
  UI: Settings → Bank Accounts tab (all portals); Onboarding step 6 (supplier + anchor only)

**Migrations in `supabase/migrations/`** (applied in order):
- `00000000000000_baseline_schema.sql` — 29 enums, 32 tables, 136 constraints, 44 indexes, functions, triggers
- `00000000000001_baseline_rls.sql` — RLS enabled + 19 policies
- `00000000000002_fix_rooms_rls.sql` — corrects self-referential rooms_private policy
- `00000000000003_missing_rls_policies.sql` — adds missing policies
- `00000000000004_passport_room_rls.sql` — RLS for passport_views, room_participants
- `00000000000005_agent_action_program_created.sql` — adds `program_created` to `agent_actions.action_type` enum
- `00000000000006_deal_status_new_values.sql` — adds new deal_status enum values
- `00000000000007_deal_flow_columns.sql` — shipment, payment, financing, dispute, overdue, amendment columns on `deals`; `deal_events` table
- `00000000000008_anchor_networks.sql` — `anchor_networks`, `anchor_network_members`, `network_invite_tokens` tables + RLS
- `00000000000009_deal_flow_update.sql` — deal flow update
- `00000000000010_bank_accounts.sql` — `bank_accounts` table + RLS (entity_type: bank|organization)
- `00000000000011_procurement_flow_v2.sql` — `listing_line_items` table; `bank_account_id` + `offer_items` on `marketplace_offers`; `deal_status` enum value `contract_pending`; deal columns for contract/invoice/bank-contract lifecycle (see below)
- `00000000000012_shipping_cost.sql` — `shipping_cost` on listings/offers
- `00000000000013_document_entity_type_listing.sql` — `documents.entity_type` gains `listing`
- `00000000000014_passport_ai_evaluated_at.sql` — `organizations.passport_ai_evaluated_at`
- `00000000000015_passport_score_reasoning.sql` — `organizations.passport_score_reasoning`
- `00000000000016_listing_min_passport_score.sql` — `marketplace_listings.min_passport_score`
- `00000000000017_passport_expert_analysis.sql` — `organizations.passport_expert_analysis` (AI CFO-grade narrative)
- `00000000000018_erp_integration.sql` — `erp_connections` + `erp_sync_data` tables (ERPNext/NetSuite/SAP/Oracle/Dynamics)
- `00000000000019_erp_odoo.sql` — expands `erp_connections.erp_type` to add `'odoo'`
- `00000000000021_agents.sql` — `org_agents` + `agent_tasks` tables (single-shot agent proposal queue; **020 does not exist, not a gap**)
- `00000000000022_deals_erp_reference.sql` — links a deal back to its originating ERP record
- `00000000000023_organizations_logo_url.sql` — `organizations.logo_url`
- `00000000000024_agent_action_type_negotiation.sql` — extends `agent_actions.action_type` enum with `negotiation_*` values + `create_marketplace_listing`/`create_financing_request`/`submit_marketplace_offer` (separate migration — `ALTER TYPE ... ADD VALUE` can't share a transaction with a statement referencing the new value)
- `00000000000025_agent_tasks_plan_status.sql` — `agent_tasks.status` gains `'executing'`; adds `agent_tasks.plan` (negotiation guardrails snapshot)
- `00000000000026_agent_negotiations.sql` — `agent_negotiations` table (the stateful negotiation process — see dedicated section below)
- `00000000000027_agent_negotiations_offer_uniqueness_per_org.sql` — uniqueness fix on `agent_negotiations.offer_id`
- `00000000000028_agent_task_threads.sql` — `agent_tasks.root_task_id` + `agent_task_messages` table (per-thread chat)
- `00000000000029_marketplace_offers_room_id.sql` — `marketplace_offers.room_id`
- `00000000000030_marketplace_offers_deal_id.sql` — `marketplace_offers.deal_id`
- `00000000000031_transactions_dd_nullable.sql` — `transactions.bank_id` / `financing_amount_requested` made nullable (Dynamic Discounting transactions are direct anchor-to-supplier with no bank — the NOT NULL constraints were inherited from the bank-financing-only original design and broke every DD offer)

---

## Role system

```typescript
// From packages/types/index.ts — always import from here
type UserRole =
  | 'bank_admin'
  | 'bank_credit_officer'
  | 'org_admin'        // org-level admin (anchor OR supplier — org.type decides)
  | 'org_member'
  | 'strike_admin'     // Strike platform admin

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']
```

> NOTE (v2): the old `anchor_*` / `supplier_*` roles are GONE. Orgs use `org_admin` / `org_member`; whether an org is a buyer (anchor) or supplier comes from `organizations.type`, not the role.

Portal derivation (`lib/portal-context.tsx`, `PortalType = 'bank'|'anchor'|'supplier'|'admin'`):
`bank_admin`/`bank_credit_officer` → `'bank'`; `org_admin`/`org_member` → `org.type` (`'anchor'` = BUYER, or `'supplier'`); `strike_admin` → `'admin'`.

---

## API route pattern — follow exactly

```typescript
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  // 1. Auth — anon client only for getUser()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. User row — admin client (need role/bank/org regardless of RLS)
  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // 3. Role gate
  if (!BANK_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 4. Scoped data query — always filter to user's bank/org
  const { data, error } = await adminClient
    .from('programs')
    .select('*')
    .eq('bank_id', userData.bank_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  return NextResponse.json({ programs: data ?? [] })
}
```

Inline the pattern above in each route (auth → user row → role gate → scoped query).
There is no shared auth helper module — `lib/api-auth.ts` was deleted (T1.5): it used
the deprecated `getSession()` and had zero importers. Do **not** reintroduce it.

**RLS is enabled.** Admin client bypasses it — always add a manual `.eq()` scope. See `skills/supabase-patterns.md`.

---

## Key field names to get right (common mistakes)

```
banks.legal_name, banks.display_name      ← NOT banks.name
transactions.financing_amount_requested   ← requested by supplier
transactions.financing_amount_approved    ← approved by bank (may differ)
transactions.invoice_due_date             ← the invoice's original due date
transactions.repayment_due_date           ← when bank gets repaid
invitations.anchor_org_id                 ← NOT invitations.org_id
documents                                 ← single unified table (no kyb_documents, no collateral table)
collateral_requirements                   ← collateral pledging (NOT a table called 'collateral')
organizations.risk_tier                   ← type: 'A'|'B'|'C'|'D' (NOT 'green'|'amber'|'red')
```

Note: `risk_tier` on `organizations` is `A|B|C|D`. The `green/amber/red` labels used in
the risk scoring API (`/api/risk/score`) are a separate computed display value stored
alongside but distinct from the formal `risk_tier` enum.

---

## Page pattern — portal pages

```typescript
'use client'
import { usePortal } from '@/lib/portal-context'  // 'bank'|'anchor'|'supplier'
import { useUser } from '@/lib/user-context'        // { id, full_name, email, role, org_id, bank_id }
import { PortalShell, Topbar } from '@/components/portal-shell'

export default function MyPage() {
  const portal = usePortal()
  const user = useUser()
  // fetch from /api/... on mount, render with PortalShell + Topbar
}
```

### AI context injection (required on every portal page)

Every portal page must set `data-page-name` and `data-ai-context` on its outermost container so
the AI overlay and `StrikeAIPanel` have full context for responses:

```tsx
<div
  data-page-name="My Page Name"
  data-ai-context={JSON.stringify({
    /* structured data relevant to the page — deals, listings, org info, etc. */
    portal,
    user_role: user?.role,
    // ... page-specific fields
  })}
>
```

The `ai-overlay.tsx` reads these via `document.querySelector('[data-page-name]')`. Always use
`JSON.stringify(...)` — plain strings are silently dropped. Every portal page in the app sets this.

---

## Design system (2026 "soft / curved / premium" redesign)

Tokens in `app/globals.css` (+ `app/marketplace.css` for Strike Place/Rooms/Passport classes). Never hardcode colors — use tokens. Corners are now ROUNDED everywhere (the old global `border-radius: 0 !important` rule was removed).

```css
--white:#FFFFFF  --offwhite:#F5F4F0  --ink:#0D0D0D  --ink-soft  --gray:#6B7280  --gray-soft:#9CA3AF
--border:rgba(0,0,0,.06)  --border-strong:rgba(0,0,0,.12)
--blue:#1428CC  --blue-hover:#0F1FA3  --blue-light:#EEF0FF      /* Strike brand blue */
--font-display / --font-body:  "Plus Jakarta Sans"             /* ALL UI text */
--font-mono: "IBM Plex Mono"   /* ONLY transaction IDs / code values — not UI chrome */

/* Semantic (pastel bg + saturated text) */
--color-green:#10B981 (bg #EDFAF4)  --color-amber:#F59E0B (bg #FEF3C7)
--color-red:#EF4444 (bg #FEE2E2)    --color-purple:#7C3AED

/* Radius + shadow tokens */
--radius-card:20px  --radius-input:12px  --radius-button/-badge:999px  --radius-nav:12px  --radius-sm:8px
--shadow-card  --shadow-elevated  --shadow-button
```

Conventions: cards = `--radius-card` + `--shadow-card`; buttons & badges = full pill (999px); inputs = 12px; sidebar active nav = `--blue-light` pill (no left-border accent). No `transform: translateY` hover lifts. No Shadcn, no Tailwind, no MUI — all hand-built CSS; check existing classes first.

### Motion system ("Quiet Intelligence")

Second layer on top of the base tokens, in `app/globals.css` + `components/motion.tsx`. Check
these before writing new loading/reveal/emphasis CSS — most needs are already covered.

```
--ease-out / --ease-spring, --dur-1/2/3    -- timing tokens
--gradient-ai, --glow-ai                    -- AI-surface-specific gradient/glow tokens
.reveal / .reveal-stagger                   -- fade+rise on mount; -stagger has 14 nth-child delay rules
.skeleton / .skeleton-circle / .skeleton-text -- loading placeholders
.card-interactive                           -- hover/press feedback for clickable cards
.ai-sheen                                   -- animated sheen sweep (@property --sheen-angle) for AI surfaces
.ai-breathe                                 -- subtle pulse, used on active/"thinking" AI indicators
.shine, .float-slow, .fade-in, .count-tabular -- misc accent animations
```

`components/motion.tsx` exports `CountUp`, `Reveal`, `Skeleton`, `SkeletonText`, `SkeletonCard`
React wrappers around the above classes. A `prefers-reduced-motion` kill-switch block disables
all of it. Used throughout dashboards, marketplace, deals, rooms, passport, auth, and AI surfaces.

---

## AI features

### Surfaces

- `app/(portal)/ai/page.tsx` (+ `ai/layout.tsx`) — the dedicated **Strike AI** page. Features:
  - localStorage conversation history, per-portal quick prompts
  - Agentic "wants to execute an action" confirmation card
  - **File upload / document attachment**: paperclip button → `POST /api/ai/upload` → extracted text
    prepended to message as `[Attached document: "filename"]\n\n{text}\n\n---\n\n{user message}`.
    Supports PDF (Claude reads via `document` block), images (Claude reads via `image` block),
    plain text / CSV / JSON / Markdown (decoded directly), DOCX/DOC/XLSX (printable-text extraction).
    Max 20 MB. Attachment pill shown in message bubble; content truncated from display after `---`.
  - Sends `model: 'sonnet'` to `/api/ai/chat`. Linked from the sidebar (`/ai`).
  - **Agentic tool use**: `/api/ai/chat` returns `tool_use` blocks → UI shows a confirmation card;
    on confirm, calls `POST /api/ai/tools/execute` → result injected as next `tool_result` message.

- `components/ai-overlay.tsx` — global overlay mounted in `portal-shell.tsx` on every page **except**
  `/ai`: a hover-pill at the bottom edge + a draggable floating cluster after the first message.
  Reads page context from the `data-page-name` / `data-ai-context` DOM attributes set on the
  main container; listens for the `strike-ai-prompt` CustomEvent (dispatched by insight cards).
  Has web search enabled (passes `search_web` + `get_financing_programs` tools for overlay sessions).
  Every portal page sets `data-ai-context` with structured JSON for fully contextual responses.

- `components/strike-ai-panel.tsx` — `StrikeAIPanel`: collapsible right-side AI context panel
  (300px width). Open/closed state persisted in localStorage `strike-ai-panel-open`. On open,
  fetches a contextual insight via `/api/ai/insight` using the current page's `data-page-name` /
  `data-ai-context`. Clears history on route change. Currently defined but not imported into any
  layout (standalone component, available for future integration).

- `components/ai-insight-card.tsx` — contextual insight banner/compact/floating cards → `/api/ai/insight`
  (session-cached, 5-min TTL). Wired into dashboard (bank), programs, transactions.
- `components/ai-insight.tsx` — inline collapsible insight widget → `/api/ai/chat`.
- `components/doc-generator.tsx` — document export. Template picker (regulatory: BCBS 239 / MAS 610 /
  EBA FinRep / KYB summary / invoice confirmation / anchor payment notice; plus generic:
  transaction summary / KYB report / financing request / PassportScore / audit log) + custom
  template upload → `/api/ai/documents`, with a markdown preview modal and Download PDF / .md.
- `components/ai-panel.tsx` — **deprecated/orphaned** (old sliding panel, replaced by `ai-overlay.tsx`).

### Routes

- `/api/ai/chat` — chat. Model routing: `model: 'sonnet'` → `claude-sonnet-4-6`, otherwise
  `claude-haiku-4-5-20251001`. Passes through optional `tools` / `tool_choice`.
- `/api/ai/insight` — insight-card JSON (haiku, 256 tokens; fail-soft).
- `/api/ai/documents` — document generation (sonnet, 4096 tokens). `custom` accepts
  `context.templateText` (fill an uploaded template) or `context.instructions`.
- `/api/ai/usage` — usage/limits for the current scope.
- `/api/ai/upload` — **multipart file upload** for Strike AI context extraction. Accepts `file` field
  (max 20 MB). Returns `{ filename, text }`. PDF/image → Claude Haiku reads content; plain text/CSV/
  JSON/MD → decoded directly; DOCX/DOC/XLSX → printable-text extraction. Usage logged to `ai_usage`
  (feature: `'insight'`). Called from `app/(portal)/ai/page.tsx` before sending message.
- `/api/ai/tools/execute` — **AI agentic tool executor**. Accepts `{ tool_name, tool_input }`.
  Auth → user row → ghost check (orgs) → bank-only gate → agent-approval preference check →
  `executeTool()` dispatch → logs to `agent_actions`. Returns `{ tool_name, result, duration_ms }`.
  On `requires_approval_for_actions` pref: returns `202 { status:'requires_approval', ... }`.

### AI Agentic Tools system (`lib/ai/tools/`)

All tools are defined in `lib/ai/tools/definitions.ts` (Claude `tool_use` schema format) and
dispatched in `lib/ai/tools/execute.ts`. Handlers live in `lib/ai/tools/handlers/`.
`lib/ai/tools/admin.ts` provides a shared service-role client for handlers.

```
ToolName (24 tools registered in definitions.ts + get_agent_tasks/get_erp_data — grep
`name: '` in lib/ai/tools/definitions.ts for the current authoritative list, this file
will drift again):

READ tools (no approval gate):
  lookup_entities            — resolve name/keyword to org/deal/financing_request UUIDs; query:"all" lists recent
  get_active_deals           — list non-completed/non-cancelled deals for an org
  evaluate_supplier_passport — evaluate org trust using KYB/financials/deals/reviews; writes PassportScore back
  find_and_recommend_deals   — match + score buyer-supplier pairing; returns suggested terms
  get_pricing_insights       — benchmark product price vs platform data + LME/CME/FAO indices
  summarize_deal_negotiation — full negotiation history: events, amendments, messages, next steps
  score_and_rank_financing_offers — rank bank offers by rate/amount/tenor/bank reputation
  detect_deal_risk_signals   — fraud, risk flags, tariff exposure, payment anomalies, concentration
  recommend_suppliers_for_buyer  — best-match suppliers by product/location/PassportScore/delivery
  generate_deal_term_sheet   — structured term sheet (parties, goods, pricing, delivery, financing)
  evaluate_listing_offers    — rank offers by price/delivery speed/counterparty trust
  get_passport_advice        — explain PassportScore drivers + specific improvement actions
  search_marketplace_listings — search public listings; emits [LISTING_CARD:{id}] for each result.
                               query is schema-required but agent-scan's freeform proposals aren't
                               schema-validated before being stored — the handler falls back to "all"
                               if a stored proposal ever omits it, rather than crashing.
  search_web                 — Brave/DuckDuckGo search for market prices, regulations, benchmarks
  get_financing_programs     — fetch financing programs available to an org (overlay tool)
  get_agent_tasks            — list an org's pending + recent agent_tasks (chat/dispatch-facing read)
  get_erp_data               — read erp_sync_data for a connected org (data_type: ar_aging|ap_aging|
                               cash_position|inventory_levels|open_orders|all); returns
                               {connected:false, message:'...'} if no active erp_connections row

WRITE tools (subject to agent_preferences require_approval_for_actions gate):
  create_marketplace_listing — create listing with line items; DOCUMENT MODE: extracts all fields from
                               attached doc automatically. Emits [LISTING_CARD:{id}] on success.
  submit_marketplace_offer   — submit/bid on a listing by listing_id. Does NOT accept offer_items
                               (no per-item pricing) — only a lump-sum offered_price/offered_quantity.
  create_financing_request   — request financing against a deal's receivable

NEGOTIATION tools — only ever offered to Claude inside the tick loop (NEGOTIATION_TOOLS in
definitions.ts), never in general chat. See "Autonomous Agent Manager" section below.
  counter_marketplace_offer  — propose improved terms; same offer_items limitation as submit above
  reject_marketplace_offer   — decline outright, ends the negotiation
  recommend_finalization     — SIGNAL-ONLY, not a real action. Calling it does nothing on its own —
                               the tick loop intercepts the tool_use block directly (NOT registered
                               in execute.ts/ToolName) and turns it into a negotiation_ready_to_finalize
                               agent_tasks row for GATE 2. This is HOW the agent recommends accepting
                               without ever being able to accept itself.

Signal-only tool for per-task plan chats (app/api/agents/tasks/[id]/messages/route.ts), also
NOT registered in execute.ts/ToolName:
  revise_proposed_action     — Claude calls this when a human asks it to change a pending proposal's
                               terms; the route intercepts the tool_use block and merges `patch` into
                               proposed_action.tool_input directly.

Intentionally NEVER given a schema in any portal's tool set: accept_marketplace_offer. Accepting
an offer creates a binding deal, so per the two-gate design this only ever executes via a human
explicitly approving a negotiation_ready_to_finalize agent_tasks row
(app/api/agents/tasks/[id]/approve/route.ts) — never via ad-hoc chat, never via the tick loop.

BANK_ONLY tools:
  proactive_portfolio_alerts — scan bank's full portfolio for risk concentration, overdue, anomalies

Orphaned handler — file exists (lib/ai/tools/handlers/get-importable-erp-deals.ts) but is NOT
registered in definitions.ts or execute.ts. Don't assume get_importable_erp_deals is callable
without checking again; it silently isn't today.
```

**LISTING_CARD directive**: when a tool emits `[LISTING_CARD:{listing_id}]` on its own line,
the Strike AI page UI renders a clickable card linking to `/marketplace/listings/{listing_id}`.
This is the general pattern for letting a tool result render as a rich UI element instead of
plain text — see it before inventing a new mechanism for AI-controlled response layout.

**Document-mode tool calling** (create_marketplace_listing): when the user attaches a document
and asks to create a listing, the AI extracts all fields from the document and calls the tool
immediately without asking follow-up questions. The `[Attached document: "filename"]` prefix in
the message signals document mode to the AI system prompt.

### AI limits & logging

- Daily limits from `ai_limits` table (scope: user|org|bank|global), fallback hardcoded in route
- Limits: chat=50, insight=200, document=20, scoring=500
- Usage logged to `ai_usage` table (fail-soft if the table is absent)
- Tool executions logged to `agent_actions` (action_type = tool_name; fail-soft)
- Default model `claude-haiku-4-5-20251001` (cost-sensitive); dedicated AI page + doc gen → `claude-sonnet-4-6`

---

## Autonomous Agent Manager & Two-Gate Negotiation

The org-level AI agent (`org_agents`, opt-in per org) can discover opportunities, draft a plan,
and — once a human approves that plan **once** — run a multi-round negotiation autonomously,
only coming back to a human again at the moment a deal would actually be finalized. This is the
core safety invariant, non-negotiable: **negotiation rounds run autonomously within guardrails,
but accepting an offer always requires a second, explicit human approval showing the final
terms.** The agent never finalizes anything a human hasn't seen.

```
GATE 1 (human approves the PLAN once)
   → agent_tasks.status: 'awaiting_approval' → 'approved' → 'executing'
   → an agent_negotiations row is created, status = 'active'
   → Autonomous tick loop (every ~2–5 min, see below):
        - counter within price_floor/price_ceiling/max_rounds/deadline → autonomous, no approval
        - terms outside guardrails, or guardrails were never configured → ESCALATE:
              new agent_tasks row (root_task_id = the GATE-1 task), type
              'negotiation_escalation', status 'awaiting_approval' — same approve/reject UI,
              no new UI needed
        - terms look acceptable → do NOT auto-accept. Set agent_negotiations.status =
              'awaiting_finalization', create a 'negotiation_ready_to_finalize' agent_tasks row
        - clearly bad offer → autonomous reject is allowed (declining commits to nothing)
GATE 2 (human approves finalization) → the ONLY place accept_marketplace_offer ever executes
```

### Key files
- **`lib/ai/agent-scan.ts`** — daily cron (`/api/agents/scan`) + manual trigger. Reads ERP
  signals + active deals + recommendations + the org's own listings, asks Claude for 1–5
  structured proposals, inserts as `agent_tasks`, notifies org_admins. For negotiation-capable
  proposal types (`create_marketplace_listing`/`submit_marketplace_offer`), also populates
  `plan` with guardrails from `agent-preferences.ts` at proposal time.
- **`lib/ai/agent-tick.ts`** (`runAgentTick(orgId?)`) — the autonomous execution engine, called by
  `/api/agents/tick`. For every `agent_negotiations` row with `status='active'`:
  1. **Atomically claims the row first** — `UPDATE ... SET last_tick_at = now() WHERE id = $1
     AND status='active' AND (last_tick_at IS NULL OR last_tick_at < now() - interval '4 minutes')
     RETURNING *` — prevents two overlapping invocations from double-acting on the same negotiation.
  2. Halts immediately if `org_agents.is_active=false` (the global kill switch), `halt_requested=true`
     (the per-negotiation "Stop" button), or the deadline has passed (hard platform-wide cap:
     `negotiation-constants.ts`'s `HARD_MAX_ROUNDS`/`HARD_MAX_DEADLINE_DAYS`, enforced no matter
     what the plan says — a safety backstop, not a business guardrail).
  3. If the last offer round wasn't made by us, calls Claude with `NEGOTIATION_TOOLS` bounded by
     a system prompt stating the plan's hard limits, plus recent room conversation for context.
  4. **Validates Claude's chosen terms server-side against the plan before executing anything**
     (`checkPriceGuardrail`) — a prompt is advisory, not a guardrail; out-of-bounds always escalates,
     never executes.
  5. Logs every action to `agent_actions`, posts a system-narration message into the task thread
     (`agent-task-chat.ts`'s `postSystemMessage`), and — critically — posts into the shared Strike
     Room too (`message_type: 'ai_suggestion'`) so the counterparty (human or their own agent) sees
     the reasoning, not just a new number.
- **`lib/marketplace/offer-actions.ts`** — shared `counterOffer`/`acceptOffer`/`rejectOffer`/
  `ensureRoom` functions. Both the human-facing route (`app/api/marketplace/offers/[id]/route.ts`)
  and the agent tool handlers call these same functions — one implementation of turn-order/
  room-creation/deal-creation logic, not two parallel ones.
- **`lib/ai/agent-preferences.ts`** — `getAgentPreferences(orgId)`, the one shared loader for the
  org's price floor/ceiling/max deal value/etc. Used both to bound proposals at scan time and as
  the enforced guardrails at tick time.
- **`lib/ai/agent-task-chat.ts`** — per-thread chat + system narration. `agent_task_messages` rows
  are always keyed to the thread's ROOT `agent_tasks.id` (via `root_task_id`), so the entire
  lineage of a negotiation (GATE-1 task → escalations → GATE-2 task) reads as one conversation.
- **`lib/ai/negotiation-constants.ts`** — the hard platform-wide caps (`HARD_MAX_ROUNDS`,
  `HARD_MAX_DEADLINE_DAYS`) that apply regardless of what an org's plan configures.

### Agent-to-agent negotiation — needs BOTH tick functions, not just one
`agent_negotiations.offer_id` is UNIQUE, so only the org that went through GATE 1
(`runAgentTick`/`tickOne`) can ever get a row tracking a given offer. Confirmed by a full live
demo run: the counterparty — the org that actually posted the listing — had zero autonomous
presence on the same offer, meaning every "agent-to-agent" counter in earlier testing was
actually a human manually countering through the UI form. **"Agent-to-agent" only actually
works because `/api/agents/tick` calls BOTH `runAgentTick` (the GATE-1 side) AND
`runListingDefenseTick` (the listing-owner side, `lib/ai/agent-tick.ts`) on every invocation.**
`runListingDefenseTick` finds offers on an active-agent org's OWN listings where it's their turn
and reacts using their standing `agent_preferences` as guardrails — no per-negotiation plan
needed, since responding on a listing you already chose to post is lower-commitment than
proposing a new deal. GATE 2 is identical either way: a good offer only ever creates a
`negotiation_ready_to_finalize` task, never an auto-accept. If you ever see a listing owner not
responding to a fresh counter, check `runListingDefenseTick` is still wired into both the GET
and POST handlers in `app/api/agents/tick/route.ts` before assuming it's an LLM/prompt issue.

**Also found in the same session**: `counter_marketplace_offer` calls from the tick loop
reliably failed with `"shipping_cost is required for incoterm CIF"` whenever the acting org was
the supplier under a seller-pays-freight incoterm (CFR/CIF/CPT/CIP/DAP/DPU/DDP) — Claude wasn't
filling the field even though the tool schema asks for it. Fixed by stating it as an explicit,
unmissable requirement in `getNegotiationDecision`'s system prompt (which now knows whether the
acting org is playing supplier or buyer) plus a code-level fallback to the offer's current
`shipping_cost` value so a single omission can never hard-fail an unattended round.

**Ad-hoc Strike AI chat does NOT enter the autonomous loop.** Asking Strike AI in the regular
Chat tab to "submit an offer" executes `submit_marketplace_offer` immediately (per the system
prompt's "execute immediately, don't ask for confirmation" instruction) but creates a bare
`marketplace_offers` row with no `agent_negotiations` row — nothing will ever autonomously
counter it afterward. Only proposals that go through the Agent tab's scan → GATE-1-approve flow
(which populates `agent_tasks.plan`) get picked up by the tick loop. If a demo needs the "then it
negotiates on its own" payoff, the initial offer must be sourced via Settings → Agent → Run Scan
Now (or the daily cron) and approved from the Agent tab — not typed into ad-hoc chat.

### UI
- **`app/(portal)/ai/page.tsx`**'s Agent tab renders `agent_tasks` as a card grid (root tasks only,
  `root_task_id IS NULL`), each opening a per-thread chat view combining `agent_task_messages` +
  the negotiation's live progress (round N of max M, guardrail-missing warning if
  `plan.guardrails_configured=false`, "Stop negotiation" button).
- **`app/(portal)/settings/agent/page.tsx`** — activation toggle, name/persona/goals, "Run Scan Now"
  (`POST /api/agents/scan`) and **"Run Negotiation Tick Now"** (`POST /api/agents/tick`, org-scoped
  via session auth — bypasses the cron secret entirely, so it works even if the scheduled cron
  isn't configured or hasn't fired yet; use this for demos rather than waiting on cron).
- **`app/(portal)/rooms/[id]/page.tsx`** — deal/listing side panel showing negotiation context
  alongside the room thread; agent reasoning appears as real `ai_suggestion` chat messages, not a
  separate summary — this is deliberately the more visceral "two negotiators talking" surface.
- Dashboard **Live Agent Activity ticker** (`AgentActivityTicker` in `dashboard/page.tsx`, backed
  by `/api/agents/activity`) — rotating feed of recent `agent_actions` across the org, ambient
  "this is happening even when you're not looking" surface.

### Known gaps (don't assume otherwise without checking)
- The scheduled `cron-agents-tick.yml` GitHub Actions workflow is **unreliable for sub-hourly
  cadences** even with `APP_BASE_URL`/`CRON_SECRET` repo secrets correctly set — GitHub's own
  scheduler has been observed firing hours apart despite a `*/2 * * * *` expression.
- **The actually-reliable path**: a `pg_cron` job (`agent-negotiation-tick`, jobid 1, schedule
  `* * * * *`) runs directly inside the Supabase Postgres instance via `pg_net`'s async HTTP
  client, calling `https://app.strikescf.com/api/agents/tick` with the `x-cron-secret` header
  every minute. Set up because a live demo can't depend on GitHub's scheduler — confirmed via
  `cron.job_run_details` / `net._http_response` firing exactly 60s apart with real HTTP 200s.
  Check `select * from cron.job_run_details where jobid=1 order by start_time desc limit 10;`
  and `select * from net._http_response order by created desc limit 10;` to verify it's alive.
  This and the GitHub Actions workflow can safely run concurrently — the tick loop's atomic
  row-claiming (`last_tick_at`, 4-minute window) means a negotiation is never double-acted on,
  a redundant caller just gets `skipped_claimed_elsewhere`. The manual "Run Negotiation Tick Now"
  button still exists as a third, on-demand path for testing a specific org immediately.
- No tool today synthesizes cash position + outstanding exposure + concentration risk into one
  call — `/api/reporting` computes the right aggregate numbers but isn't registered as an AI tool.

---

## ERP integration (real, live connectors — not a mock)

`erp_connections` + `erp_sync_data` (migrations 018/019) back a genuine external integration,
not a demo stub — `app/api/erp/sync/route.ts` speaks real Odoo XML-RPC and ERPNext REST APIs
(SSRF-guarded on `base_url`), fetching AR/AP aging, cash position, inventory levels, open orders,
and production capacity, and upserting into `erp_sync_data` (`UNIQUE(org_id, data_type)`).

- **`app/api/erp/connect/route.ts`** — org_admin connects an ERPNext/Odoo instance (base URL, API
  key/secret); UI at Settings → ERP Integration tab (`app/(portal)/settings/page.tsx`, `tab='erp'`).
- **`app/api/erp/sync/route.ts`** — daily cron (`cron-erp-sync.yml`, 06:00 UTC) + manual "Sync Now".
- **`lib/ai/tools/handlers/get-erp-data.ts`** (`get_erp_data` tool) — chat/dispatch-facing read;
  returns `{connected:false, message:'...'}` if no active connection, or the synced `data_type`
  rows otherwise.
- No seed data exists anywhere for `erp_sync_data` — a fresh demo org has zero ERP context until
  either a real Odoo/ERPNext sandbox is connected and synced, or rows are hand-inserted directly.
- `lib/ai/agent-scan.ts`'s own ERP query only sees data once the sort-column bug is fixed (it was
  ordering by a column, `synced_at`, that doesn't exist on `erp_sync_data` — the real column is
  `fetched_at` — which silently zeroed out the daily scan's ERP context even for connected,
  synced orgs; `get_erp_data` was never affected, only the background scan was).

---

## Risk scoring

`/api/risk/score` — 4 components × 25 pts = 100 max:
1. KYB/compliance (from `organizations.kyb_status`)
2. Tariff/geo exposure (from `market_signals` table, `signal_type='country_risk'`)
3. Transaction performance (on-time rate from `transactions`)
4. Financial health (from `credit_scores.total_score` or `organizations.credit_score`)

Result stored on `organizations`: `risk_score` (integer), `risk_flags` (jsonb), `tariff_exposure` (jsonb).
Formal tier: `organizations.risk_tier` is `A|B|C|D` (set via credit process).
Display tier from risk score: green ≥70, amber 45–69, red <45 (separate computed value).

---

## Transaction lifecycle

```
draft → pending_anchor_initiation → pending_anchor_approval →
pending_anchor_confirmation → pending_bank_review → more_info_requested →
financing_approved_pending_collateral → financing_approved → funded →
pending_delivery_confirmation → delivery_confirmed → repayment_due →
completed | rejected | cancelled | in_dispute
```

Transaction events are logged to `transaction_events` for every status change.

---

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
RESEND_API_KEY
CRON_SECRET              ← required; middleware gates /api/risk/refresh-signals on x-cron-secret header
NEXT_PUBLIC_DEV_BANK_ID=ff1a209f-aa2a-471c-95c8-9d01018cdecd
```

Cron-gated routes (all check `x-cron-secret` against `CRON_SECRET`). NOT declared in
`vercel.json` — Vercel Hobby caps cron jobs at 2/day and we have 5, one needing 5-minute
frequency, so native Vercel Cron isn't usable on Hobby. Instead scheduled via GitHub
Actions (`.github/workflows/cron-*.yml`, free on Hobby) — each workflow calls its route
on the schedule below using `curl` with header `x-cron-secret: ${{ secrets.CRON_SECRET }}`.
Requires two repo secrets set in GitHub → Settings → Secrets and variables → Actions:
`APP_BASE_URL` (the deployed app's base URL) and `CRON_SECRET` (must match the Vercel env
var of the same name). Caveat: GitHub auto-disables scheduled workflows after 60 days
with no repo activity — a commit or manual "Run workflow" re-enables them. If/when
upgrading to Vercel Pro, delete the `.github/workflows/cron-*.yml` files and re-add a
`crons` array to `vercel.json` instead (native, no 60-day-inactivity risk).
- `cron-risk-refresh-signals.yml` → `/api/risk/refresh-signals` — daily 00:00 UTC
- `cron-deals-check-overdue.yml` → `/api/deals/check-overdue` — daily 08:00 UTC (moves overdue deals to `payment_overdue`; 2-business-day grace if financing still pending)
- `cron-erp-sync.yml` → `/api/erp/sync` — daily 06:00 UTC
- `cron-agents-scan.yml` → `/api/agents/scan` — daily 07:00 UTC
- `cron-agents-tick.yml` → `/api/agents/tick` — schedule expression `*/2 * * * *`, but treat this as
  best-effort only: GitHub's own scheduler has been observed firing hours apart regardless of the
  expression, even with secrets correctly configured. For anything time-sensitive (demos, testing),
  use the "Run Negotiation Tick Now" button in Settings → Agent instead (org-scoped session auth,
  bypasses GitHub Actions and the cron secret entirely) or `workflow_dispatch` via `gh workflow run`.

**External packages** (`next.config.js` `serverExternalPackages`): `pdfkit` is excluded from
webpack bundling. Any route using PDFKit must use `export const runtime = 'nodejs'`.

---

## Dev seed accounts

Created by `supabase/seed.sql` (T1.3). All passwords: `DevPass123!`.

```
sarah@atlasbank.dev     / DevPass123! → bank_admin           (Atlas Bank)
james@atlasbank.dev     / DevPass123! → bank_credit_officer  (Atlas Bank)
buyer@pacific.dev       / DevPass123! → org_admin            (Pacific Dynamics — anchor/buyer)
supplier@westcoast.dev  / DevPass123! → org_admin            (Westcoast Fabricators — supplier)
supplier@coastal.dev    / DevPass123! → org_admin            (Coastal Suppliers — supplier)
admin@strikescf.com     / DevPass123! → strike_admin         (Strike platform)
```

Atlas Bank's id is `NEXT_PUBLIC_DEV_BANK_ID` (ff1a209f-aa2a-471c-95c8-9d01018cdecd).

**Also live in the dev database, created via `/signup` during agent-negotiation testing — NOT in
`seed.sql`, so a fresh `supabase db reset` will NOT bring these back:**
```
jfurner@walmart.com     / DevPass123! → org_admin (Walmart Inc., anchor)      org_id 23945f06-58b7-48d2-86af-6b584edc536a
ahmedd2004@gmail.com    / DevPass123! → org_admin (Rocket Corp, anchor)       org_id b8d9a8db-9c68-49f9-b8e8-c5f9a24afebd
sarah@atlasbank.dev is the same Atlas Bank account above — used as the bank counterparty for
these orgs' financing throughout agent-negotiation testing.
```
This Walmart/Rocket Corp pair is what the two-window live negotiation demo scenario is built
around — both orgs have `org_agents.is_active=true` and real negotiation history between them.

---

## What NOT to do

- **Never** use `createClient()` (anon) for data queries — only for `getUser()`
- **Never** use admin client without a manual `.eq()` scope filter
- **Never** hardcode UUIDs outside seed files
- **Never** reference `kyb_submissions`, `kyb_documents`, or `collateral` — these tables don't exist
- **Never** use `invitations.org_id` — the field is `anchor_org_id`
- **Never** use `banks.name` — fields are `legal_name` and `display_name`
- **Never** use `transactions.financing_amount` — use `financing_amount_requested` or `financing_amount_approved`
- **Never** install an ORM (Prisma, Drizzle) — Supabase JS client only
- **Never** use `getSession()` in API routes — use `getUser()` (more secure)
- **Never** create a `proxy.ts` — it was renamed to `middleware.ts` (T1.1); Next.js only auto-runs `middleware.ts`. Edit the existing `apps/web/middleware.ts`.
- **Never** import `pdfkit` in a Webpack bundle — it is listed in `serverExternalPackages` in `next.config.js` (added to prevent bundling). Always `export const runtime = 'nodejs'` in routes that use it.
- **Never** gate features on `organizations.status = 'active'` — use `org.network_visible && org.kyb_status !== 'not_started'` (the platform-unlock check). `status = 'active'` is only set post-approval, which is no longer required for feature access.
- **Never** add new env vars without updating `.env.production.example`
- **Don't** create Supabase clients inline in page files — import from `lib/supabase/`
- **Don't** add Redux or Zustand — use React context (already set up)

---

## TypeScript checking

```bash
# Always run from apps/web — not from the monorepo root
cd apps/web && npx tsc --noEmit
```

---

## Strike Place, Rooms & Passport (v2 additions)

### New route groups
- app/(portal)/marketplace/ — Strike Place hub, listings, financing
- app/(portal)/deals/ — Deal lifecycle (marketplace + imported)
- app/(portal)/rooms/ — Strike Rooms (private deal rooms + public)
- app/(portal)/passport/ — Strike Passport + peer reviews
- app/(portal)/networks/ — Anchor Supplier Networks (list + [id] detail; role-aware: anchor vs supplier view)
- app/(portal)/supply-graph/ — Supply Graph "Coming Soon" page (bank portal)
- app/(portal)/admin/ — Strike admin (strike_admin role only)
- app/(portal)/settings/agent/ — AI Agent preferences
- app/(auth)/invite/[token]/ — Network invite landing page (public, no portal shell)

### Signup flow (self-registration)

Only **anchor (buyer)** and **supplier** orgs can self-register at `/signup`. Bank accounts are provisioned manually by Strike — the signup page shows a "contact us" note instead of a bank option. There is no "both" role.

- `app/(auth)/signup/page.tsx` — collects role (anchor|supplier), full name, email, company name, country, password. On success, signs the user in and redirects to **`/onboarding`** (not `/dashboard`). Invite-token signups are the only exception: they redirect to `/dashboard` with a welcome message after auto-accepting the network membership.
- The signup UI uses an AI-feel design: animated gradient orbs in the background, elevated white card (`--radius-card`, strong shadow), blue→purple gradient submit button with shimmer, 2-column role cards with gradient icon on selection.
- `app/api/auth/register/route.ts` — accepts `org_type: 'anchor' | 'supplier'` only (rejects `'bank'` at the API layer too, as a backstop).

### Onboarding wizard (`app/(onboarding)/`)

- `layout.tsx` — left rail uses the actual `logo.png` image (not a placeholder "S" square). Provides `WizardContext` with the step tracker.
- `onboarding/page.tsx` — 8-step KYB/Passport activation wizard. Steps: 1 Identity & Legal, 2 Address & Contact, 3 Ownership & Compliance, 4 Financial & Trade, 5 Systems & Intent, 6 Bank Accounts (new — supplier+anchor only; saves to `bank_accounts` via `/api/settings/bank-accounts`), 7 Documents, 8 Review & Submit. At the bottom of every step's footer there is a **"Do this later — explore as guest"** button that routes to `/dashboard`. Clicking it leaves the user in ghost mode (kyb_status remains `'not_started'`); they can activate their Passport from the dashboard at any time.

### Ghost mode (Tier 0)

An org is a ghost when `kyb_status = 'not_started'` AND `network_visible = false`. This is set at signup.

- `components/ghost-gate.tsx` — `GhostGate` wraps all children in `(portal)/layout.tsx`. Detects ghost state via `useUser()` hook + `network_visible` flag; renders a lock screen for all portal pages.
- `components/ghost-lock.tsx` — `GhostLock` renders the locked-state card with "Activate Passport →" CTA.
- **Platform unlocks** when `kyb_status` changes to `'submitted'` (Passport submitted) — simultaneously sets `network_visible = true`. Users do NOT need to wait for approval.
- Ghost orgs are excluded from all counterparty queries at the API layer: every listing/financing browse route adds `.eq('network_visible', true)` filter. Ghost orgs can READ public data but never appear TO others.
- `kyb_status === 'not_started'` = locked (ghost). `kyb_status !== 'not_started'` = unlocked (all features). Approval (`'approved'`) is NOT required for feature access.

### New API routes
All new API routes follow existing patterns (service role for writes,
anon client for reads with RLS). Key routes:
- /api/marketplace/listings — CRUD for marketplace listings
- /api/marketplace/offers — Submit/counter/accept/reject offers
- /api/marketplace/financing — Financing requests (org + bank sides)
- /api/marketplace/financing/[id]/offers — Bank offer submission
- /api/marketplace/financing/[id]/accept — Accept financing offer
- /api/deals — Deal CRUD + status transitions
- /api/deals/import — Create imported (pre-existing) deals
- /api/deals/extract — AI document extraction (Haiku)
- /api/deals/[id]/generate-documents — AI doc generation (Haiku)
- /api/deals/[id]/payment-instructions — Seller sets bank details; advances agreed→documents_pending
- /api/deals/[id]/ship — Seller marks shipped (tracking ref, carrier, optional invoice upload)
- /api/deals/[id]/delivery — CONFIRMED ORPHANED, zero callers in the frontend. All real transitions
  (including delivery confirmation) go through /api/deals/[id]/transition. Do not add logic here —
  it will never run. This route is where payment_due_date used to be calculated; that logic now
  lives in transition/route.ts's `nextStatus === 'delivery_confirmed'` branch. (Its sibling,
  the equally-orphaned /api/deals/[id]/payment, was already deleted — this one wasn't, yet.)
- /api/deals/[id]/cancel — Cancel with server-enforced policy (blocked ≥ shipped or financing_payment_active)
- /api/deals/[id]/amendment — POST propose / PATCH respond; locked when financing_payment_active
- /api/deals/[id]/dispute — Submit evidence (action=submit_evidence) or Strike Admin resolves (action=resolve)
- /api/deals/[id]/upload-document — Multipart upload to deal-documents bucket; G7 duplicate invoice check
- /api/deals/[id]/events — GET deal_events audit log (party members only)
- /api/deals/[id]/documents — GET list of documents attached to a deal
- /api/deals/[id]/download-document — GET (with ?doc_id=); generates a signed PDF via PDFKit for
  contract documents. Uses `bufferPages:true` for page count. Falls back to document lookup if
  preview param set. Returns `application/pdf` stream.
- /api/deals/check-overdue — Vercel cron (daily 08:00 UTC); moves overdue deals to payment_overdue; G9 grace period for pending financing
- /api/deals/[id]/transition — POST; canonical route for ALL deal status changes; action + payload; returns updated deal + financing_context
- /api/deals/[id]/available-actions — GET; returns {actions, financing_context, deal_status, user_role} for UI + AI agent
- /api/deals/[id]/acknowledge-noa — POST; buyer acknowledges Invoice Factoring NOA; unlocks payment instructions
- /api/deals/[id]/dd-offer — POST; anchor (buyer) presents Dynamic Discounting early payment offer to supplier
- /api/deals/[id]/dd-respond — POST; supplier accepts ({accepted:true}) or declines ({accepted:false}) DD offer
- /api/marketplace/financing/[id]/reject — Close financing request without activation; structure-aware revert (IF clears NOA, PO blocked post-conversion)
- /api/marketplace/financing/[id]/upload-document — POST; multipart upload for financing request documents
- /api/rooms — Room list + create public room
- /api/rooms/[id]/messages — Send message + AI moderation
- /api/passport/[org_id] — Full passport profile
- /api/passport/recalculate — PassportScore recomputation
- /api/passport/reviews — Peer review submission
- /api/passport/reviews/check — GET ?deal_id={id} → { already_reviewed: boolean }
- /api/passport/[org_id]/narrative — GET; AI-generated 2-3 sentence Passport narrative (Sonnet; 7-day
  TTL cache on the org row). Also returns AI CFO-grade assessment vs network medians.
- /api/passport/[org_id]/documents — GET; list KYB/Passport documents for an org's public profile
- /api/passport/[org_id]/view — POST; record a passport view (viewer_org_id/bank_id, context)
- /api/settings/agent — Agent preferences CRUD (preference_type: `require_approval_for_actions`; value: `{enabled:bool}`)
- /api/risk/signals — GET; market_signals table (country_risk type); ?country_code= for single country or all
- /api/notifications — Notification center
- /api/admin/* — Strike admin actions
- /api/organizations/search — Network-visible org search
- /api/networks — GET (anchor's networks) / POST (create network)
- /api/networks/[id] — PATCH (update) / DELETE (delete; blocked if active members)
- /api/networks/[id]/members — GET (anchor-only member list; suppliers cannot see other members)
- /api/networks/[id]/invite — POST (invite existing org or new email)
- /api/networks/[id]/accept — POST (supplier accepts invitation)
- /api/networks/[id]/decline — POST (supplier declines invitation)
- /api/networks/[id]/members/[org_id] — PATCH (update notes/status) / DELETE (remove member)
- /api/networks/supplier — GET (supplier's own network memberships; never includes other members)
- /api/invite/[token] — GET (public; returns anchor/network info for landing page)
- /api/invite/[token]/accept — POST (called after Tier 0 signup via invite link; auto-activates membership)
- /api/agents/config — GET/PATCH org's agent config (name, persona, goals)
- /api/agents/activate — POST toggle `org_agents.is_active` (the global kill switch)
- /api/agents/scan — POST manual scan trigger (also called by cron)
- /api/agents/tick — GET (cron, `x-cron-secret`) or POST (cron secret OR org_admin session, scoped
  to their own org — the reliable manual-trigger path, see Autonomous Agent Manager section)
- /api/agents/tasks — GET root-level agent_tasks (root_task_id IS NULL) for the auth'd org
- /api/agents/tasks/[id]/approve — POST; executes proposed_action, or for a negotiation-capable
  proposal, flips to 'executing' + creates the agent_negotiations row (GATE 1)
- /api/agents/tasks/[id]/reject — POST with optional reason
- /api/agents/tasks/[id]/retry — POST; resets a failed/rejected task back to awaiting_approval
- /api/agents/tasks/[id]/halt — POST org_admin-only; sets agent_negotiations.halt_requested=true
- /api/agents/tasks/[id]/messages — GET/POST per-thread chat (see agent-task-chat.ts)
- /api/erp/connect — GET/POST/DELETE the org's erp_connections row
- /api/erp/sync — GET/POST; pulls live data from the connected Odoo/ERPNext instance into erp_sync_data
- /api/marketplace/offers/[id] — GET (added; the PATCH-only route gained a read path) + PATCH
- /api/marketplace/stats — GET; Strike Place Quick Stats (active_deals/orgs/volume — previously hardcoded placeholders)
- /api/documents/[id]/url — GET; signed URL resolution, `canAccessDocument()` now also handles
  `entity_type==='financing_request'` (previously a permanent 403 for everyone on financing contracts)

### Financing-structure-aware deal flow (DEAL-FLOW implementation)

Four financing structures are a **lens** over the deal flow — steps don't change, but rendering/amounts/recipient/gates do. All logic lives in one place:

- **`lib/deals/financing-context.ts`** — `getFinancingContext(deal, txn, program, bankOrg, supplierOrg)` is the single source of truth. Returns `FinancingContext` with all UI-relevant fields. Pure function, no imports from component files. Import from here; never compute financing logic elsewhere.
- **`lib/deals/fees.ts`** — Fee calculation utilities for deal financing structures.
  - `DealFinancingStructure` = `'reverse_factoring' | 'invoice_factoring' | 'po_financing' | 'dynamic_discounting' | null` (local type — do NOT confuse with `FinancingStructure` from `packages/types/index.ts` which is `'preset'|'custom'|'open'`)
  - DB uses `type: 'factoring'` for IF; `mapStructure()` normalizes both to `'invoice_factoring'`
- **`lib/deals/transitions.ts`** — `PERMITTED_TRANSITIONS` map; `getPermittedTransition(status, action, role, fc)` returns the rule or null.
- **`components/deals/DealRoadmap.tsx`** — receives `FinancingContext` as props; zero financing logic inside.
- **`components/deals/ActionPanel.tsx`** — receives `availableActions` + `FinancingContext` as props; zero financing logic inside. Sub-components: `FinancingActiveBanner`, `DDOfferForm`, `NOAAcknowledgmentForm`, `DDRespondForm`, `GenericActionForm`.
- **Deal page (`app/(portal)/deals/[id]/page.tsx`)** computes `financingContext` via `getFinancingContext()` then passes it to both components. Sets `data-ai-context` attribute for the AI overlay.
- **RF gate**: can only request after `delivery_confirmed` (post-shipment). **PO gate**: must request at `confirmed` or `in_preparation` (pre-shipment). **IF NOA gate**: buyer must acknowledge before `confirm_payment_sent` is available. **DD flow**: anchor presents offer → supplier accept/decline.
- `transactions.repayment_routing` (TEXT): `'buyer_to_bank'` (RF/IF/PO) or `'direct'` (DD).

### Anchor Supplier Networks (NETWORKS implementation)

Networks are anchor-owned closed groups. Visibility is enforced at the API layer on every listing/financing request query.

- **`lib/networks/visibility.ts`** — single source of truth for network visibility filtering.
  - `getVisibilityFilter(admin, orgId)` → `{publicOnly, activeNetworkIds}` — call before any listing/financing browse
  - `buildListingVisibilityOr(filter, orgId)` → OR string for Supabase query builder (uses `org_id` not `poster_org_id`)
  - `isListingVisibleToOrg(admin, listing, orgId)` → bool — used in [id] GET routes for network-only 404s
- Ghost mode: `network_visible=false` orgs return empty arrays from every browse/list route
- Network-only listings/financing requests: return 404 (not 403) to non-members — never reveal they exist
- Supplier isolation: `GET /api/networks/[id]/members` is anchor-only; suppliers get 403
- Invite flow: existing orgs receive in-platform notification + email → accept/decline in /networks portal page
- New email invites: create `network_invite_tokens` row → invite landing page `/invite/[token]` → signup with pre-filled fields → auto-accept via `POST /api/invite/[token]/accept`
- Banks are NEVER part of supplier networks — network visibility has no effect on bank-facing financing requests
- `Networks` nav item added to BOTH anchor and supplier sidebars (position: after Financing, before Strike Rooms)
- Supplier dashboard: pending network invitations widget shown when `status='invited'` memberships exist

### Deal role determination — CRITICAL

**Never use `organizations.type` to determine buyer/seller on a deal.**
Always derive from `deals.buyer_org_id` / `deals.supplier_org_id`.

- In API routes: `deal.buyer_org_id === userData.org_id ? 'buyer' : 'supplier'`
- Canonical utility: `lib/deals/roles.ts` → `getDealRoles(deal, userOrgId)` and `getRolesFromListingType(listingType, listingOrgId, offerorOrgId)`

When creating a deal from an accepted offer, derive buyer/seller from `listing_type` (NOT `org.type`):
- `listing_type === 'po_request'` → poster = buyer, offeror = supplier
- `listing_type === 'product_service'` → poster = supplier, offeror = buyer

The `deals` table has `buyer_org_id` and `supplier_org_id` (NOT seller_org_id) — both NOT NULL with a CHECK(`buyer_org_id != supplier_org_id`). If roles are wrong, the INSERT fails.

### Counter-offer turn logic

Counter-offers are bidirectional. Turn is tracked via `offer_rounds[last].by_org_id`:
- No rounds yet (initial offer): listing owner goes first
- `lastRound.by_org_id === offerorOrgId` → listing owner's turn
- `lastRound.by_org_id === listingOrgId` → offeror's turn

Backend enforces this in `app/api/marketplace/offers/[id]/route.ts`.
Frontend reflects it in `app/(portal)/marketplace/listings/[id]/page.tsx` (Counter button hidden when it's not your turn; Accept always shown).

### Financing acceptance must NOT change deal status

`app/api/marketplace/financing/[id]/accept/route.ts` must NOT update `deals.status`. The deal flow continues normally. `financing_payment_active` is set to `true` only when the bank disburses.

The deal GET route (`app/api/deals/[id]/route.ts`) fetches the linked transaction when `financingRequest?.status === 'accepted'` (not only when `financing_payment_active`), so the transaction card appears immediately after bank offer acceptance.

**Bank-user lookup on the deal GET route**: bank users have no `org_id`, so `financing_request` cannot be looked up by `requesting_org_id = userData.org_id` the way org parties do. Instead, the route derives it from the bank's own `transactions` row on the deal via `transactions.financing_request_id`. The route also returns `bank_bank_account` (the bank's own receiving account, surfaced once financing is active — see Task 2 below) and `requester_bank_account` (the financing requester's own account, looked up by `entity_type:'organization', entity_id: financingRequest.requesting_org_id`, gated on `financingRequest.status` being `accepted`/`funded`) so the bank automatically sees where to disburse without the requester re-entering it.

### Two separate "contract" flows — do not conflate

There are two independent contract-signature features on a deal. They use different tables/columns, different API routes, and different participants:

1. **Deal-level trade contract** (`app/api/deals/[id]/contract/route.ts`) — between the buyer and supplier on the deal itself, independent of financing. Buyer submits (AI-generated via `callClaude`, or uploads) while `deal.status === 'agreed'` → deal advances to `contract_pending`, stored in `documents` (`document_kind:'trade_contract'`), columns `deals.contract_document_id/generated_at/submitted_at/submitted_by`. Supplier signs (`contract_supplier_signature/signed_at`) → deal advances to `confirmed`, optionally attaching `receiving_bank_account_id`; this auto-generates an AI commercial invoice (`document_kind:'commercial_invoice'`, `deals.deal_invoice_document_id/number/generated_at`, format `INV-${shortId}`). The same route also has an `action==='bank'`/`action==='bank_sign'` branch for a bank-submitted financing contract tied to `deal.financing_payment_active` (`deals.bank_contract_document_id/submitted_at/submitted_by`, `bank_contract_signature/signed_by/signed_at`) — this is deal-level, NOT the same row as #2 below.
2. **Financing-request contract** (`app/api/marketplace/financing/[id]/contract/route.ts`) — between the bank and the party that requested financing (buyer or supplier), scoped to the `financing_request`'s own `transactions` row (`esign_document_id`, `bank_signed_at`, `anchor_signed_at`/`supplier_signed_at` depending on `isRequesterBuyer`, `esign_completed_at`). This is the contract step in the **financing management lifecycle** (see below) and is rendered by `FinancingManagementCard.tsx`, not by the deal-level contract UI.

### Financing management lifecycle (Task 3/4 — this session)

Once a financing offer is accepted, the requesting party manages the rest of the lifecycle from the financing detail page (`app/(portal)/marketplace/financing/[id]/page.tsx`); the bank manages the same lifecycle from the deal detail page (`app/(portal)/deals/[id]/page.tsx`, `user_role === 'bank'` branch). Both render the shared `components/deals/FinancingManagementCard.tsx` (prop-driven, no internal fetching) against the same `financing_request`/`transactions` row, in three steps:

1. **Contract** — bank submits/generates a contract (`POST /api/marketplace/financing/[id]/contract`, sets `transactions.esign_document_id`/`bank_signed_at`); requester signs (`PATCH` same route, sets `anchor_signed_at` or `supplier_signed_at` depending on `isRequesterBuyer`, and `esign_completed_at` once both sides have signed).
2. **Disbursement** — once `esign_completed_at` is set, the bank sends a payment reference (`POST /api/transactions/[id]/disburse`, sets `disbursed_at`/`disbursed_by_user_id`/`disbursement_reference`). The bank automatically sees the requester's own bank account here (no manual entry) — see `requester_bank_account` above.
3. **Confirm receipt** — the requester confirms funds arrived (`POST /api/marketplace/financing/[id]/confirm-received`, sets `transactions.supplier_paid_at`).

On the deals page, `canFinance` (the "Request Financing" CTA gate) requires `user_role !== 'bank'` — banks never request financing on a deal, only manage it.

### Listing line items + AI extraction (procurement-flow-v2)

- `listing_line_items` rows can be entered manually or AI-extracted from an uploaded document via `POST /api/marketplace/listings/extract` (Haiku; accepts PDF/image/DOCX/DOC/TXT/CSV).
- CRUD: `GET/POST /api/marketplace/listings/[id]/line-items`, `PATCH/DELETE /api/marketplace/listings/[id]/line-items/[itemId]`.
- Document attach/replace for a listing: `app/api/marketplace/listings/[id]/document/route.ts`.
- The financing page's goods row shows BOTH the listing title and the actual goods/line-item description — previously only the title was shown, which was ambiguous when the listing title didn't match the underlying goods.

### Key design decisions
- deal_source: 'marketplace' | 'imported' | 'direct' on deals table
- Supabase Realtime on: room_messages, notifications,
  marketplace_offers, financing_request_offers, deals
- All AI calls use claude-haiku-4-5-20251001 (cost-sensitive)
- PassportScore recalculates on: deal completion, peer review received
- Private rooms auto-create on first counter-offer
- AI document generation fires on deal status → 'agreed'
- Financing acceptance creates a transaction row in the SCF engine
  (source='marketplace') — bridges marketplace to existing SCF flow
- Deal flow status machine: negotiating→agreed→contract_pending→documents_pending→confirmed→
  in_preparation→shipped→delivery_confirmed→[payment_due/overdue]→
  payment_confirmed→completed; financing_payment_active=true forks payment to bank
  (contract_pending is optional — only entered if the buyer submits a trade contract at 'agreed')
- financing_payment_active: bool on deals — set true when bank advance disbursed;
  blocks amendments, cancellation, and changes buyer's payment target to the bank
- payment_due_date: calculated from agreed_payment_terms (Net\d+ regex) on delivery confirmation —
  this happens inside /api/deals/[id]/transition/route.ts's `nextStatus === 'delivery_confirmed'`
  branch (the ONLY place it's set); do not add a second implementation elsewhere
- amendment_history: JSONB array (AmendmentRecord[]); only one pending at a time;
  server rejects if financing_payment_active or status not in confirmed/in_preparation/active
- Cancellation: server-enforced; cancellable only at negotiating/agreed/documents_pending/
  confirmed/in_preparation/active; blocked at shipped and later; reason required at in_preparation
- Dispute: raised by buyer at shipped; both parties submit evidence; Strike Admin resolves
  with buyer_favor→cancelled, seller_favor→delivery_confirmed, mutual_settlement→completed,
  escalated→stays in_dispute
- Overdue cron: /api/deals/check-overdue (daily 08:00 UTC via vercel.json); 2-business-day
  grace period if financing_request still open/offers_received at due date (G9.1)
- Invoice duplicate detection: on commercial_invoice upload, checks documents table for
  same org; if found, logs agent_actions fraud_flagged and returns warning in response
- deal_events: write an event row after every status change or significant action;
  use this table for the deal timeline (not agent_actions)

### Supabase Storage buckets required
- kyb-documents (private) — KYB uploads
- deal-documents (private) — Deal import uploads
