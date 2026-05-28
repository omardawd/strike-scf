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
│   │   ├── portal-shell.tsx ← Sidebar, topbar, notification bell
│   │   ├── dashboard/    ← Role-aware dashboard (bank/anchor/supplier views)
│   │   ├── programs/     ← Program list, detail, new program wizard
│   │   │   └── [id]/
│   │   │       ├── anchor/[anchor_id]/          ← Bank → Anchor drilldown
│   │   │       └── anchor/[anchor_id]/supplier/ ← Bank → Anchor → Supplier
│   │   ├── transactions/ ← Transaction list, detail, new transaction wizard
│   │   ├── kyb/          ← KYB review (bank sees all, orgs see own)
│   │   │   └── [org_id]/
│   │   ├── collateral/   ← Collateral requirements management
│   │   ├── reporting/    ← Analytics & reporting
│   │   └── settings/     ← Profile, bank settings, team management
│   │       └── team/
│   └── api/              ← Next.js API routes (see patterns below)
├── components/           ← Shared UI components
├── lib/                  ← Utilities, Supabase clients, contexts
└── reference/            ← Original design mockups (JSX/HTML) — use for design reference
```

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
  invitation_id, created_at, updated_at

users
  id (= auth.users.id), email, full_name,
  role (bank_admin|bank_credit_officer|anchor_admin|anchor_member|
        supplier_admin|supplier_member),
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

---

## Role system

```typescript
// From packages/types/index.ts — always import from here
type UserRole =
  | 'bank_admin'
  | 'bank_credit_officer'
  | 'anchor_admin'
  | 'anchor_member'
  | 'supplier_admin'
  | 'supplier_member'

// Convenience groups used in every API route:
const BANK_ROLES     = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES   = ['anchor_admin', 'anchor_member']
const SUPPLIER_ROLES = ['supplier_admin', 'supplier_member']
```

Portal derivation: `bank_*` → `'bank'`, `anchor_*` → `'anchor'`, `supplier_*` → `'supplier'`

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

Reusable helpers in `lib/api-auth.ts`: `requireAuth()`, `requireRole()`, `requireBankAccess()`, `requireOrgAccess()`.

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

## Design system

Tokens in `app/globals.css`. Never hardcode colors.

```css
--white, --offwhite, --ink, --ink-soft, --gray, --gray-soft
--border, --border-strong
--blue: #0052FF  --blue-hover  --blue-dim
--font-display: "Space Grotesk"   /* headings, numbers */
--font-body: "DM Sans"            /* body text */
--font-mono: "IBM Plex Mono"      /* amounts, IDs, code */

/* Semantic */
--color-green: #059669  --color-amber: #D97706
--color-red: #DC2626    --color-purple: #7C3AED
```

No Shadcn, no Tailwind, no MUI. All UI is hand-built CSS classes in `globals.css`. Check existing classes before writing new ones.

---

## AI features

- `components/ai-panel.tsx` — sliding chat panel → `/api/ai/chat`
- `components/ai-insight.tsx` — inline insight widget
- Daily limits come from `ai_limits` table (scope: user|org|bank|global), fallback hardcoded in route
- Limits: chat=50, insight=200, document=20, scoring=500
- Usage logged to `ai_usage` table
- Model: `claude-haiku-4-5-20251001` — always this model for in-app AI (cost-sensitive)

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
NEXT_PUBLIC_DEV_BANK_ID=ff1a209f-aa2a-471c-95c8-9d01018cdecd
```

---

## Dev seed accounts

```
sarah@atlasbank.dev  / DevPass123! → bank_admin
james@pacdyn.dev     / DevPass123! → anchor_admin
rachel@westcoast.dev / DevPass123! → supplier_admin
mike@deltacomp.dev   / DevPass123! → supplier_admin
```

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
- **Never** add new env vars without updating `.env.production.example`
- **Don't** create Supabase clients inline in page files — import from `lib/supabase/`
- **Don't** add Redux or Zustand — use React context (already set up)

---

## TypeScript checking

```bash
# Always run from apps/web — not from the monorepo root
cd apps/web && npx tsc --noEmit
```
