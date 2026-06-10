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
│   ├── deals/DealRoadmap.tsx     ← Deal timeline/roadmap (receives FinancingContext as props)
│   ├── ai-overlay.tsx            ← Global AI overlay (hover-pill + draggable cluster); mounted on every page except /ai
│   ├── ai-insight-card.tsx       ← Contextual AI insight banner/compact/floating → /api/ai/insight
│   ├── ai-insight.tsx            ← Inline collapsible AI insight widget → /api/ai/chat
│   ├── ai-panel.tsx              ← DEPRECATED/ORPHANED — old sliding panel, replaced by ai-overlay.tsx
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

deal_status enum values (all live):
  negotiating | agreed | documents_pending | confirmed | in_preparation
  shipped | delivery_confirmed | in_dispute | payment_due | payment_overdue
  payment_confirmed | completed | cancelled
  active | financing_requested | financing_active | disputed   ← legacy aliases, keep for compat

deal_events                 -- audit log for deal lifecycle events (created by migration 007)
  id, deal_id, event_type, actor_user_id, actor_org_id, description, metadata, created_at
  RLS: org members can read events for deals they are party to

marketplace_listings        -- Strike Place product/PO listings
                            -- visibility (public|network_only), network_id FK → anchor_networks
marketplace_offers          -- offers on listings (realtime-subscribed)
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
                            -- action_type, entity_type, entity_id, reasoning, input_summary,
                            -- output_summary, outcome, requires_approval, human_approved,
                            -- approved_by_user_id, approved_at, model, tokens_used
agent_preferences           -- org-level AI hard limits/rules: org_id, preference_type,
                            -- value(jsonb), label, is_active, set_by_user_id
ai_negotiation_state        -- per-deal: deal_id(unique), current_round, last_offer_snapshot,
                            -- negotiation_history, agent_recommendation, agent_confidence,
                            -- market_context, suggested_counter
```

> NOT yet in the live schema (planned for Track 2): `erp_connections`,
> `erp_sync_data`, `ai_signals`, `ai_signal_resolutions`.

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

---

## AI features

Surfaces:
- `app/(portal)/ai/page.tsx` (+ `ai/layout.tsx`) — the dedicated **Strike AI** page: localStorage
  conversation history, per-portal quick prompts, agentic "wants to execute an action"
  confirmation card. Sends `model: 'sonnet'` to `/api/ai/chat`. Linked from the sidebar (`/ai`).
- `components/ai-overlay.tsx` — global overlay mounted in `portal-shell.tsx` on every page **except**
  `/ai`: a hover-pill at the bottom edge + a draggable floating cluster after the first message.
  Reads page context from the `data-page-name` / `data-ai-context` DOM attributes; listens for the
  `strike-ai-prompt` CustomEvent (dispatched by insight cards).
- `components/ai-insight-card.tsx` — contextual insight banner/compact/floating cards → `/api/ai/insight`
  (session-cached, 5-min TTL). Wired into dashboard (bank), programs, transactions.
- `components/ai-insight.tsx` — inline collapsible insight widget → `/api/ai/chat`.
- `components/doc-generator.tsx` — document export. Template picker (regulatory: BCBS 239 / MAS 610 /
  EBA FinRep / KYB summary / invoice confirmation / anchor payment notice; plus generic:
  transaction summary / KYB report / financing request / PassportScore / audit log) + custom
  template upload → `/api/ai/documents`, with a markdown preview modal and Download PDF / .md.
- `components/ai-panel.tsx` — **deprecated/orphaned** (old sliding panel, replaced by `ai-overlay.tsx`).

Routes:
- `/api/ai/chat` — chat. Model routing: `model: 'sonnet'` → `claude-sonnet-4-6`, otherwise
  `claude-haiku-4-5-20251001`. Passes through optional `tools` / `tool_choice`.
- `/api/ai/insight` — insight-card JSON (haiku, 256 tokens; fail-soft).
- `/api/ai/documents` — document generation (sonnet, 4096 tokens). `custom` accepts
  `context.templateText` (fill an uploaded template) or `context.instructions`.
- `/api/ai/usage` — usage/limits for the current scope.

Limits & logging:
- Daily limits come from `ai_limits` table (scope: user|org|bank|global), fallback hardcoded in route
- Limits: chat=50, insight=200, document=20, scoring=500
- Usage logged to `ai_usage` table (fail-soft if the table is absent)
- Default model `claude-haiku-4-5-20251001` (cost-sensitive); the dedicated AI page and document
  generation route to `claude-sonnet-4-6`.

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

Vercel crons (`vercel.json`):
- `/api/risk/refresh-signals` — daily 00:00 UTC (gated by `CRON_SECRET` in middleware)
- `/api/deals/check-overdue` — daily 08:00 UTC (moves overdue deals to `payment_overdue`; 2-business-day grace if financing still pending)

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
- `onboarding/page.tsx` — 7-step KYB/Passport activation wizard. At the bottom of every step's footer there is a **"Do this later — explore as guest"** button that routes to `/dashboard`. Clicking it leaves the user in ghost mode (kyb_status remains `'not_started'`); they can activate their Passport from the dashboard at any time.

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
- /api/deals/[id]/delivery — Buyer confirms delivery or raises dispute (action=confirm|dispute)
- /api/deals/[id]/payment — Buyer confirms payment sent (action=buyer_confirm); seller confirms receipt (action=seller_confirm)
- /api/deals/[id]/cancel — Cancel with server-enforced policy (blocked ≥ shipped or financing_payment_active)
- /api/deals/[id]/amendment — POST propose / PATCH respond; locked when financing_payment_active
- /api/deals/[id]/dispute — Submit evidence (action=submit_evidence) or Strike Admin resolves (action=resolve)
- /api/deals/[id]/upload-document — Multipart upload to deal-documents bucket; G7 duplicate invoice check
- /api/deals/[id]/events — GET deal_events audit log (party members only)
- /api/deals/check-overdue — Vercel cron (daily 08:00 UTC); moves overdue deals to payment_overdue; G9 grace period for pending financing
- /api/deals/[id]/transition — POST; canonical route for ALL deal status changes; action + payload; returns updated deal + financing_context
- /api/deals/[id]/available-actions — GET; returns {actions, financing_context, deal_status, user_role} for UI + AI agent
- /api/deals/[id]/acknowledge-noa — POST; buyer acknowledges Invoice Factoring NOA; unlocks payment instructions
- /api/deals/[id]/dd-offer — POST; anchor (buyer) presents Dynamic Discounting early payment offer to supplier
- /api/deals/[id]/dd-respond — POST; supplier accepts ({accepted:true}) or declines ({accepted:false}) DD offer
- /api/marketplace/financing/[id]/reject — Close financing request without activation; structure-aware revert (IF clears NOA, PO blocked post-conversion)
- /api/rooms — Room list + create public room
- /api/rooms/[id]/messages — Send message + AI moderation
- /api/passport/[org_id] — Full passport profile
- /api/passport/recalculate — PassportScore recomputation
- /api/passport/reviews — Peer review submission
- /api/passport/reviews/check — GET ?deal_id={id} → { already_reviewed: boolean }
- /api/settings/agent — Agent preferences CRUD
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

### Financing-structure-aware deal flow (DEAL-FLOW implementation)

Four financing structures are a **lens** over the deal flow — steps don't change, but rendering/amounts/recipient/gates do. All logic lives in one place:

- **`lib/deals/financing-context.ts`** — `getFinancingContext(deal, txn, program, bankOrg, supplierOrg)` is the single source of truth. Returns `FinancingContext` with all UI-relevant fields. Pure function, no imports from component files. Import from here; never compute financing logic elsewhere.
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
- Deal flow status machine: negotiating→agreed→documents_pending→confirmed→
  in_preparation→shipped→delivery_confirmed→[payment_due/overdue]→
  payment_confirmed→completed; financing_payment_active=true forks payment to bank
- financing_payment_active: bool on deals — set true when bank advance disbursed;
  blocks amendments, cancellation, and changes buyer's payment target to the bank
- payment_due_date: calculated from agreed_payment_terms (Net\d+ regex) on delivery confirmation
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
