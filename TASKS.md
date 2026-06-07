# Strike SCF — TASKS.md
> Multi-agent build plan. Generated from PROJECT_STATE.md (real codebase sweep, 2026-06-06) + Phase 2 product spec.
> Hand this file to the Claude Code orchestrator. Each TRACK is one agent lane.
> Tracks 1–3 are sequential and blocking. Tracks 4–8 are parallelizable after Track 1 completes.
> Every agent must read `apps/web/CLAUDE.md` in full before touching any code.

---

## CRITICAL CONVENTIONS (every agent must follow)

- **Auth:** `getUser()` always — never `getSession()`. Admin client + manual `.eq()` scope filter for all data queries (RLS is bypassed by service role).
- **AI model:** `claude-haiku-4-5-20251001` hardcoded for all in-app AI. Never change this.
- **CSS:** Hand-built CSS with design tokens only. No Tailwind, no shadcn, no MUI. Tokens in `app/globals.css` + `app/marketplace.css`.
- **DB references:** Never reference non-existent tables (`kyb_documents`, `collateral` as a table). Documents table is unified. `invitations.anchor_org_id` not `org_id`. `banks.legal_name`/`display_name` not `banks.name`.
- **Types:** Import shared types from `packages/types`.
- **Columns that exist in code but not in docs:** `organizations.network_visible`, `organizations.passport_score`, `deals.deal_source` — these are real, treat them as canonical.
- **Roles:** `org_admin` / `org_member` (not the old `anchor_admin`/`supplier_admin`).
- **No tests yet:** Do not block on tests. Track 3 adds them. Ship working code first.

---

## TRACK 1 — REPO HYGIENE (DO FIRST — BLOCKING ALL OTHER TRACKS)

> Status: v2 branch committed. Now fix the structural issues before any agent writes new code.
> Agent: Solo. Sequential. Estimated: 2–3 hours.

### T1.1 — Fix the orphaned middleware
- **Problem:** `apps/web/proxy.ts` is a full auth/cron middleware that never executes. Next.js only auto-runs `middleware.ts`. The `CRON_SECRET` gate on `/api/risk/refresh-signals` is inactive.
- **Action:**
  1. Rename `proxy.ts` → `middleware.ts`
  2. Ensure it exports `middleware` function and `config` with matcher
  3. Verify the cron route `/api/risk/refresh-signals` checks `CRON_SECRET` internally as a fallback
  4. Test: unauthenticated request to a portal route should redirect to `/login`
  5. Test: request to cron route without secret should return 401

### T1.2 — Generate baseline schema migration from live Supabase  ✅ DONE
- **Resolved:** Dumped the live DB (project `dthkgrnhlxkzvkegvure`) via the Supabase MCP — `npx supabase db dump` was never usable (no DB password / Docker), so the schema was reconstructed from the system catalogs (`pg_get_constraintdef`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, etc.). Two baseline migrations now exist:
  - `supabase/migrations/00000000000000_baseline_schema.sql` — 29 enums, 32 tables, 136 constraints (93 FKs), 44 indexes, 10 functions, 17 triggers, 1 `ensure_rls` event trigger.
  - `supabase/migrations/00000000000001_baseline_rls.sql` — RLS enabled on all 32 tables + 19 policies across 12 tables.
  - The two pre-baseline files (`add_deal_source.sql`, `20260527000001_add_invitation_status_values.sql`) were removed: superseded by the baseline, and the latter referenced an `invitation_status` enum that no longer exists (would break a fresh `db push`).
  - **Note:** 20 tables have RLS enabled with no policy (deny-all to anon/auth); the live `rooms_private` policy has a self-referential predicate (`room_participants.room_id = room_participants.id`) — both captured faithfully, neither fixed here.
- **Original action:**
  1. Run `npx supabase db dump --schema public > supabase/migrations/$(date +%Y%m%d)_baseline_schema.sql`
  2. Verify migration covers all tables including v2: `marketplace_listings`, `marketplace_offers`, `financing_requests`, `financing_request_offers`, `deals`, `rooms`, `room_messages`, `passport_peer_reviews`
  3. Confirm columns `organizations.network_visible`, `organizations.passport_score`, `deals.deal_source` are captured
  4. Add a `supabase/migrations/$(date +%Y%m%d)_baseline_rls.sql` dumping all RLS policies
  5. Commit both files

### T1.3 — Fix seed.sql with real dev data structure
- **Problem:** `seed.sql` is intentionally empty. Dev accounts listed in CLAUDE.md don't exist from the repo.
- **Action:**
  1. Write `supabase/seed.sql` that creates:
     - 1 bank: Atlas Bank (`bank_admin`: sarah@atlasbank.dev, `bank_credit_officer`: james@atlasbank.dev)
     - 1 anchor org: Pacific Dynamics (`org_admin`: buyer@pacific.dev)
     - 2 supplier orgs: Westcoast Fabricators (`org_admin`: supplier@westcoast.dev), Coastal Suppliers (`org_admin`: supplier@coastal.dev)
     - 1 strike_admin: admin@strikescf.com
  2. Seed one program, one enrollment, one transaction in each key lifecycle state
  3. Update CLAUDE.md dev accounts section to match

### T1.4 — Reconcile and update CLAUDE.md
- **Problem:** CLAUDE.md has stale role names, missing v2 columns, fake seed accounts.
- **Action:**
  1. Update roles section: `org_admin`/`org_member` are canonical (remove `anchor_admin`/`supplier_admin`)
  2. Add v2 columns to schema block: `organizations.network_visible (boolean)`, `organizations.passport_score (integer)`, `deals.deal_source (enum: marketplace|imported|direct)`
  3. Update dev seed accounts to match T1.3
  4. Add v2 table list to schema section
  5. Add note: "proxy.ts has been renamed to middleware.ts — do not create a new proxy.ts"

### T1.5 — Delete or adopt lib/api-auth.ts
- **Problem:** `lib/api-auth.ts` exports `requireAuth()` using deprecated `getSession()`. Zero routes import it. Dead misleading code.
- **Action:** Delete the file entirely. It contradicts the auth conventions every agent must follow.

---

## TRACK 2 — SCHEMA AS CODE + TYPE SAFETY (blocking Tracks 4–8 for new tables)

> Depends on: Track 1 complete.
> Agent: Solo. Estimated: 3–4 hours.

### T2.1 — Generate TypeScript DB types from schema
- **Action:**
  1. Run `npx supabase gen types typescript --local > packages/types/database.types.ts`
  2. Ensure all 26+ tables are represented including v2 tables
  3. Export from `packages/types/index.ts`
  4. Fix any TypeScript errors that surface from the newly typed queries (there will be some)

### T2.2 — Add missing v2 tables to schema if absent
- **Check each of these exists in the baseline migration. If missing, write a new migration:**
  - `erp_connections` — for ERP integration (new, needed for Track 7)
  - `erp_sync_data` — normalized ERP data cache (new, needed for Track 7)
  - `ai_signals` — detected signals from signal engine (new, needed for Track 8)
  - `ai_signal_resolutions` — tracks when a signal was acted on (new, needed for Track 8)
  - ~~`ai_actions_log`~~ — USE EXISTING `agent_actions` table (already in live schema). Do NOT create duplicate.
- **Schema for new tables:**

```sql
-- ERP connections per org
CREATE TABLE erp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  erp_type TEXT NOT NULL CHECK (erp_type IN ('netsuite', 'sap', 'oracle', 'dynamics')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disconnected')),
  credentials_encrypted JSONB, -- store encrypted, never plaintext
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Normalized ERP data cache (refreshed on sync)
CREATE TABLE erp_sync_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  erp_connection_id UUID REFERENCES erp_connections(id),
  data_type TEXT NOT NULL CHECK (data_type IN (
    'cash_position', 'ar_aging', 'ap_aging',
    'inventory_levels', 'open_orders', 'payment_terms', 'production_capacity'
  )),
  data JSONB NOT NULL,
  period_start DATE,
  period_end DATE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, data_type)
);

-- AI-detected signals
CREATE TABLE ai_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'capital_stress', 'inventory_shortage', 'payment_term_pressure',
    'concentration_risk', 'trapped_liquidity', 'fx_exposure',
    'supplier_distress', 'program_underutilization',
    'procurement_timing_mismatch', 'fraud_indicator',
    'unfunded_invoices', 'default_early_warning'
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  recommended_action TEXT,
  action_type TEXT CHECK (action_type IN (
    'request_financing', 'post_listing', 'open_room',
    'submit_invoice', 'review_supplier', 'none'
  )),
  action_payload JSONB, -- pre-filled params for the action
  source TEXT NOT NULL DEFAULT 'platform' CHECK (source IN ('platform', 'erp')),
  related_entity_type TEXT, -- 'transaction' | 'program' | 'deal' | 'supplier'
  related_entity_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'resolved', 'expired')),
  dismissed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log for every AI-executed action
CREATE TABLE ai_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  signal_id UUID REFERENCES ai_signals(id),
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  confirmation_shown_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  result_entity_type TEXT,
  result_entity_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'executed', 'failed', 'cancelled')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### T2.3 — Write RLS policies for new tables
- `erp_connections`: org members can read own org's connections; no cross-org access; bank can read connections for orgs in their programs
- `erp_sync_data`: same as erp_connections
- `ai_signals`: org members read own signals; strike_admin reads all
- `ai_actions_log`: org members read own; strike_admin reads all

---

## TRACK 3 — TESTING & CI (can run parallel to Track 4+ once Track 1 done)

> Depends on: Track 1 complete.
> Agent: Solo. Estimated: 4–6 hours.

### T3.1 — Install and configure Vitest
- Add `vitest` + `@testing-library/react` + `jsdom` to `apps/web`
- Configure `vitest.config.ts` with path aliases matching `tsconfig.json`
- Add `"test": "vitest run"` to package.json scripts

### T3.2 — Unit tests for critical business logic
Write tests for (these have no side effects, pure logic):
- `lib/passport.ts` — score calculation functions
- `lib/ai.ts` — `extractJson()` parsing edge cases
- Risk scoring model: 4-component 25pt model in `risk/score`
- Transaction state machine: valid/invalid transitions
- Signal detection logic (once written in Track 8)

### T3.3 — API route integration tests (key paths)
Using Vitest + mock Supabase client:
- Auth: unauthenticated request returns 401
- Programs: bank can only see own bank's programs
- Transactions: supplier cannot access another org's transactions
- KYB: bank credit officer can approve, supplier cannot
- Marketplace: financing offer accept spawns a transaction correctly

### T3.4 — GitHub Actions CI
```yaml
# .github/workflows/ci.yml
- tsc --noEmit
- eslint --max-warnings 0
- vitest run
- Runs on: push to main, all PRs
```

---

## TRACK 4 — CLASSIC SCF POLISH (parallel after Track 1)

> Depends on: Track 1.
> Agent: Solo. Estimated: 6–8 hours.

### T4.1 — Transaction lifecycle edge cases
Review the 16-state machine for these known gaps:
- `in_dispute` → resolution paths (resolve/escalate/close)
- `cancelled` state: which roles can cancel at which states
- Concurrent approval race condition: two bank users approving simultaneously
- Ensure every status transition writes a `transaction_events` row with correct actor

### T4.2 — Collateral lifecycle completion
- Verify all statuses flow: `pending → submitted → approved/rejected/waived/released`
- Ensure waive and release are only accessible to `bank_admin`
- Document upload validation: file type + size limits enforced server-side (not just UI)

### T4.3 — Credit decision countersign
- `credit_decision_records` has countersign fields — verify the countersign endpoint exists and is wired to the UI
- If missing: add `POST /api/kyb/[org_id]/countersign` route + bank UI button

### T4.4 — Reporting accuracy audit
- Cross-check `/api/reporting` aggregations against raw transaction data
- Verify `financing_amount_approved` vs `invoice_amount` calculations are consistent
- Fix any off-by-one or timezone errors in date bucketing

### T4.5 — Rate limiting audit
- `lib/rate-limit.ts` is 22 LOC — verify it is actually applied to:
  - All `/api/ai/*` routes
  - `/api/auth/register`
  - `/api/onboarding/submit`
- If not applied: add rate limit middleware to these routes

---

## TRACK 5 — V2 MARKETPLACE / DEALS / ROOMS COMPLETION (parallel after Track 1)

> Depends on: Track 1. Track 2 recommended first for type safety.
> Agent: Solo. Estimated: 8–12 hours.

### T5.1 — Marketplace realtime subscriptions
- **Problem:** Marketplace/financing realtime is NOT subscribed in the client — requires manual refresh.
- **Action:** Add Supabase Realtime subscriptions in:
  - `marketplace/[id]` listing page — subscribe to `marketplace_offers` for live offer updates
  - `marketplace/financing/[id]` page — subscribe to `financing_request_offers`
  - `deals/[id]` page — subscribe to `deals` for status changes
- Pattern: follow existing `rooms/[id]` realtime implementation exactly

### T5.2 — Financing offer → transaction bridge hardening
- The accept flow spawns an SCF transaction — audit this path end to end:
  1. Financing offer accepted → transaction created with correct `program_id`, `anchor_id`, `supplier_id`, `bank_id`
  2. Transaction status starts at correct state (`draft` or `pending_bank_review`?)
  3. `deal_source: 'marketplace'` is set correctly on the spawned deal
  4. Notification sent to all three parties on spawn
  5. Write a test for this flow (Track 3 can parallel)

### T5.3 — Strike Rooms: public room discovery
- Public rooms are defined but discovery UI may be incomplete
- Verify: any org can browse public rooms, filter by category/industry
- Verify: joining a public room adds the org as a member, shows in their room list
- Add: room categories (industry, product type, financing type) if not yet seeded

### T5.4 — Rooms: AI moderation hardening
- Room messages go through AI moderation — verify:
  1. Moderation runs async (doesn't block message send)
  2. Flagged messages are soft-hidden (not deleted) and visible to strike_admin
  3. Strike Admin room reports page shows flagged messages with context
  4. False positive rate: review prompt in the route and tighten if needed

### T5.5 — Deal import flow completion
- `deals/import` (670 LOC) with AI document extraction (`deals/extract`)
- Test: upload a real invoice PDF → AI extracts fields → deal created with correct data
- Verify: `deal_source: 'imported'` set correctly
- Edge case: AI extraction fails → user can manually fill fields → deal still created

### T5.6 — Three financing request types (full implementation)
Currently the marketplace has financing requests. Verify all three types are fully implemented:
- **Preset Program:** requestor selects RF/DD/IF/PO with standard parameters → bank sees structured request
- **Custom Structure:** requestor defines own rate/tenor/terms → bank sees freeform request
- **Open Request:** fully open, no structure specified → all banks can submit any offer type
- If any type is stubbed or incomplete: implement fully including the bank-side offer form

---

## TRACK 6 — PASSPORT & NETWORK (parallel after Track 1)

> Depends on: Track 1. Track 2 for type safety.
> Agent: Solo. Estimated: 6–8 hours.

### T6.1 — PassportScore behavioral data upgrade
- **Current state:** Score seeded from KYB/onboarding data (static)
- **Target:** Score powered by live platform behavioral data
- Add these inputs to the scoring model:
  - On-time payment rate (from `transactions` where `status='completed'`, compare `repayment_due` vs actual)
  - Dispute rate (`transactions` where `status='in_dispute'` / total completed)
  - Response time (average time from invoice submission to bank decision)
  - Offer acceptance rate (marketplace offers accepted / submitted)
  - Program utilization rate (financed amount / available limit)
- Trigger `passport/recalculate` to run after: every transaction completion, every dispute, every offer outcome

### T6.2 — Smart counterparty matching in Strike Place
- When buyer posts a PO listing, supplier offers should be **ranked by fit** not by submission time
- Ranking factors: PassportScore, delivery history, geographic risk, sector alignment, volume capability
- Implement ranking in `marketplace/listings/[id]` API — sort offers by composite score before returning
- Show ranking rationale to the buyer ("Ranked #1 — PassportScore 84, 100% on-time delivery")

### T6.3 — Passport public profile completeness
- Verify all 6 sections render with real data: Business Identity, Financial Snapshot, Platform Behavior, Trade History, Market Reputation, PassportScore ring
- Financial Snapshot: show "ERP-verified" badge when `erp_connections` record exists for this org (Track 7 will add the data)
- Peer reviews: verify submission, moderation, and display all work end to end
- Add: "View Passport" CTA on every supplier card in the marketplace

### T6.4 — Network graph enhancements
- Verify `supply-graph.tsx` renders correctly for large networks (50+ nodes)
- Color coding: green ≥70, amber 45–69, red <45 PassportScore — verify this uses live score
- Clickable nodes: clicking a supplier node navigates to their Passport profile
- Add: bank-level network view showing all anchors and their supplier networks

---

## TRACK 7 — ERP INTEGRATION LAYER (parallel after Track 2)

> Depends on: Track 2 (needs erp_connections + erp_sync_data tables).
> Agent: Solo. Estimated: 10–14 hours. This is the most complex track.

### T7.1 — ERP connection management UI
Create `(portal)/settings/erp/` page (all portals — bank, anchor, supplier all can connect ERPs):
- List connected ERPs with status badge (active/error/disconnected/pending)
- "Connect ERP" button → modal with ERP type selector (NetSuite, SAP, Oracle, Dynamics)
- Connection form: credentials input (API key / OAuth depending on ERP type)
- Test connection button → calls `/api/erp/test` → shows success/error
- Disconnect button with confirmation
- Last synced timestamp + manual "Sync now" trigger

### T7.2 — ERP connector API routes
Create `/api/erp/` routes:
- `POST /api/erp/connect` — save encrypted credentials, create `erp_connections` record
- `POST /api/erp/[id]/test` — test connectivity, return success/error
- `POST /api/erp/[id]/sync` — trigger manual sync for one connection
- `DELETE /api/erp/[id]` — disconnect
- `GET /api/erp/` — list org's connections
- `GET /api/erp/[id]/data` — get latest synced data by type

**Credential storage:** Never store plaintext. Encrypt with `SUPABASE_ENCRYPTION_KEY` env var before storing in `erp_connections.credentials_encrypted`.

### T7.3 — NetSuite connector (implement first — most common)
Create `lib/erp/netsuite.ts`:
```typescript
interface ERPDataNormalized {
  cash_position: { current_balance: number; currency: string; as_of: string }
  ar_aging: { current: number; days_30: number; days_60: number; days_90_plus: number; total: number }
  ap_aging: { current: number; days_30: number; days_60: number; days_90_plus: number; total: number }
  inventory_levels: Array<{ sku: string; name: string; qty_on_hand: number; reorder_point: number; days_of_cover: number }>
  open_orders: Array<{ order_id: string; counterparty: string; amount: number; due_date: string; status: string }>
  payment_terms: Array<{ counterparty_id: string; counterparty_name: string; agreed_days: number; actual_avg_days: number }>
}
```
- Implement `fetchNetSuiteData(credentials): Promise<ERPDataNormalized>`
- Map NetSuite REST API responses to normalized schema
- Write to `erp_sync_data` table on success

### T7.4 — SAP connector (stub with normalized interface)
Create `lib/erp/sap.ts` — same interface as NetSuite, SAP-specific API calls.
For now: implement the interface + auth handshake. Data mapping can be completed later.

### T7.5 — Oracle connector (stub)
Create `lib/erp/oracle.ts` — same interface, Oracle Fusion API. Stub implementation.

### T7.6 — Daily ERP sync cron
Add to Vercel cron (`vercel.json`): `/api/erp/sync-all` daily at 02:00 UTC.
- Fetches all `erp_connections` where `status='active'`
- Calls the appropriate connector for each
- Writes normalized data to `erp_sync_data` (upsert by `org_id + data_type`)
- Updates `last_sync_at` on success, `sync_error` on failure
- Sends notification to org if sync fails 3 consecutive times

### T7.7 — ERP data display in portal
- **Bank portal — KYB review:** Show ERP financial snapshot alongside KYB documents (if org has active ERP connection)
- **Anchor portal — supplier detail:** Show supplier's ERP-verified financial health (if they've granted visibility)
- **Supplier portal — dashboard:** Show their own ERP data summary (cash position, AR/AP overview)
- Add "ERP Verified" badge to PassportScore display when ERP data is current (synced within 48h)

---

## TRACK 8 — STRIKE AI: SIGNAL ENGINE + ACTION AGENT (parallel after Track 2)

> Depends on: Track 2 (needs ai_signals + ai_actions_log tables). Track 7 for ERP signals (but platform-only signals can ship without Track 7).
> Agent: Solo. Estimated: 12–16 hours. This is the highest-value track.
> Ship in two sub-phases: 8A (platform signals, no ERP needed) then 8B (ERP signals).

---

### PHASE 8A — Platform Signal Engine (no ERP dependency)

### T8.1 — Signal detection engine: core
Create `lib/signals/detector.ts` — the main signal detection runner:
```typescript
async function detectSignalsForOrg(orgId: string, orgType: 'bank' | 'anchor' | 'supplier'): Promise<Signal[]>
```
- Queries platform data (transactions, programs, marketplace, passport)
- Returns array of detected signals with severity, title, body, recommended_action
- Idempotent: if a signal of this type already exists as 'active' for this org, skip (don't duplicate)
- Runs per-org, designed to be called from cron or on-demand

### T8.2 — Platform-only signals (no ERP required)

**For Suppliers:**

`unfunded_invoices` — Query: transactions where `status='financing_approved'` and `funded_at IS NULL` and `created_at < NOW() - INTERVAL '3 days'` for this supplier.
Signal: "You have $X in approved invoices that haven't been funded. Financing them today would provide immediate working capital."
Action: `request_financing` with pre-filled transaction IDs.

`payment_term_pressure` — Query: compare `programs.payment_terms_days` vs actual average days from `transaction_events` (submission → completion). If actual > agreed by >20%.
Signal: "Your average days-to-payment from [Anchor] has increased from X to Y days — a Z-day extension you haven't financed."
Action: `request_financing`.

`program_window_expiry` — Query: transactions eligible for financing where the program submission window closes within 6 days.
Signal: "You have $X in invoices eligible for [Program] that expire from the financing window in N days."
Action: `submit_invoice`.

`concentration_risk_supplier` — Query: if >75% of invoice volume in last 90 days is from single anchor.
Signal: "87% of your invoice volume comes from a single buyer. Strike Place has buyers in your category actively posting POs."
Action: `post_listing`.

**For Anchors:**

`supplier_unfunded_invoices` — Query: approved invoices across all enrolled suppliers not yet funded, grouped by supplier.
Signal: "Your supplier [Name] has $X in approved invoices they haven't financed. Early payment could strengthen this relationship."
Action: `open_room` with supplier.

`program_underutilization` — Query: `programs` where `(total_financed / credit_limit) < 0.4` and program is active.
Signal: "Your [Program] has $X in available capacity. N enrolled suppliers have qualifying invoices they haven't submitted."
Action: `open_room` (mass outreach).

`supplier_distress_early_warning` — Query: supplier's invoice submission frequency down >30% month-over-month AND financing request size up >30%. Cross-reference dispute rate trend.
Signal: "Behavioral signals for [Supplier] have deteriorated. Pattern is consistent with early financial distress."
Action: `review_supplier` (navigate to their passport).

**For Banks:**

`portfolio_concentration` — Query: if >60% of `transactions.financing_amount_approved` in active status is from one anchor or one sector.
Signal: "Your portfolio has X% exposure to [Anchor/Sector]. Consider diversification."
Action: `none` (informational).

`default_early_warning` — Query: suppliers with PassportScore dropping >15 points in 30 days AND repayment due in next 60 days.
Signal: "Behavioral distress signals for [Supplier] suggest elevated default risk. Recommend proactive outreach."
Action: `review_supplier`.

`kyb_queue_aging` — Query: KYB applications in `pending` status for >5 business days.
Signal: "N KYB applications have been pending for over 5 days. Delays impact supplier onboarding velocity."
Action: navigate to KYB queue.

### T8.3 — Signal detection cron
Add to Vercel cron: `/api/signals/detect` every 6 hours.
- Fetches all active orgs
- Runs `detectSignalsForOrg` for each
- Writes new signals to `ai_signals` table
- Sends push notification for `high` and `critical` signals

### T8.4 — Signal API routes
- `GET /api/signals` — list active signals for the requesting org (filtered by role)
- `POST /api/signals/[id]/dismiss` — mark signal dismissed
- `POST /api/signals/[id]/resolve` — mark signal resolved (usually called after action taken)
- `GET /api/signals/count` — count of active signals (for notification badge)

---

### PHASE 8B — ERP Signal Engine (requires Track 7)

### T8.5 — ERP-powered signals

**Capital stress** — Source: `erp_sync_data` where `data_type='cash_position'` + `ap_aging`.
Detection: If `cash_position.current_balance < (ap_aging.current * 1.2)` AND org has unfunded approved invoices.
Signal: "Your cash runway based on current payables is X days. You have $Y in approved invoices. Financing them today extends your runway to Z days."
Action: `request_financing` with pre-filled params.

**Inventory shortage** — Source: `erp_sync_data.inventory_levels`.
Detection: Any SKU where `days_of_cover < reorder_point_days * 0.5`.
For anchor: Signal: "Your supplier [Name] inventory signals show X days of cover — below their historical buffer. Strike Place has N alternatives in this category."
For supplier: Signal: "Your [SKU] inventory is X days from depletion. PO Financing could cover your reorder."
Action: `post_listing` (anchor) or `request_financing` (supplier).

**Procurement timing mismatch** — Source: `open_orders` + `cash_position`.
Detection: Large open PO due to ship within 30 days AND cash position < 80% of PO value.
Signal: "You have a $X PO from [Buyer] due in N days. PO Financing through Strike could cover production costs before shipment."
Action: `request_financing` with `financing_type='po_financing'`.

**AR trapped liquidity** — Source: `ar_aging`.
Detection: `ar_aging.days_60 + ar_aging.days_90_plus > cash_position.current_balance * 0.5`.
Signal: "You have $X in receivables aged 60+ days. Invoice Factoring could unlock this capital immediately."
Action: `request_financing` with `financing_type='invoice_factoring'`.

**Payment term drift** — Source: `erp_sync_data.payment_terms`.
Detection: `actual_avg_days > agreed_days * 1.2` for any anchor relationship.
Signal: "[Anchor] is paying on average X days late vs your Y-day terms. This is costing you $Z/month in working capital."
Action: `request_financing`.

**FX exposure flag** — Source: `open_orders` where currency != org's base currency.
Detection: Open orders in foreign currency with >3% FX movement in last 30 days.
Signal: "You have $X in [Currency] receivables. Recent FX movement has reduced effective value by $Y."
Action: `none` (informational, no Strike product solves FX directly yet).

### T8.6 — ERP fraud detection signals
Compare ERP data against submitted invoices:
- Invoice amount > corresponding PO amount in buyer's ERP → flag to bank
- Supplier submitting invoice for goods their ERP shows not shipped → flag to bank
- Same invoice pattern submitted to multiple programs → flag to bank
Write `fraud_indicator` signals only to bank portal (never surface to supplier being flagged).

---

### PHASE 8C — AI Action Agent (the chat + automation layer)

### T8.7 — Redesigned Strike AI interface (replaces ai-panel)
The existing `ai-panel.tsx` is being replaced. Build new `components/strike-ai/` directory:

**`strike-ai-trigger.tsx`** — floating button, present on every portal page. Shows unread signal count badge. Opens the Strike AI overlay.

**`strike-ai-overlay.tsx`** — full-screen slide-in panel (not a small sidebar). Three tabs:
- **Signals** — list of active detected signals for this org, sorted by severity. Each signal has a "Take Action" button.
- **Chat** — conversational interface with the action agent
- **History** — log of all AI actions taken, with status (confirmed/executed/failed)

**`strike-ai-chat.tsx`** — the chat interface:
- Streaming responses (fixes the existing blocking `callClaude` — use SSE)
- Context-aware: knows current user, org, portal, page, and active signals
- Tool-calling enabled: can read org data AND execute actions (with confirmation)

### T8.8 — AI streaming (critical UX fix)
- **Problem:** `callClaude()` is a single blocking fetch. Long responses (doc gen, risk analysis) feel frozen.
- **Fix:** Add streaming variant to `lib/ai.ts`:
```typescript
async function callClaudeStream(
  systemPrompt: string,
  messages: Message[],
  tools?: Tool[]
): Promise<ReadableStream>
```
- Use Anthropic streaming API (`stream: true`)
- Wire to new chat interface via Server-Sent Events
- Apply to: AI chat, document generation, risk summaries

### T8.9 — Action agent tool definitions
Define the tool set the AI agent can call. Each tool maps to an existing API route:

```typescript
const AGENT_TOOLS = [
  // Supplier tools
  { name: 'create_marketplace_listing', description: 'Create a product/service listing on Strike Place', params: { title, description, price_per_unit, quantity, currency, delivery_days, category } },
  { name: 'request_financing', description: 'Submit a financing request for an approved invoice or PO', params: { transaction_id?, financing_type, amount, notes } },
  { name: 'submit_invoice', description: 'Submit an invoice for financing against a program', params: { program_id, anchor_id, invoice_number, invoice_amount, invoice_date, due_date } },
  
  // Anchor tools
  { name: 'post_po_listing', description: 'Post a Purchase Order listing on Strike Place', params: { product_category, quantity, delivery_location, delivery_date, budget_range, notes } },
  { name: 'approve_invoice', description: 'Approve a pending invoice from a supplier', params: { transaction_id } },
  { name: 'invite_supplier', description: 'Invite a supplier to a financing program', params: { supplier_email, program_id, invite_mode } },
  { name: 'open_room', description: 'Open a Strike Room with a counterparty', params: { counterparty_org_id, topic, initial_message } },
  
  // Bank tools
  { name: 'submit_financing_offer', description: 'Submit a financing offer on a marketplace financing request', params: { financing_request_id, rate_apr, tenor_days, advance_rate, notes } },
  { name: 'approve_kyb', description: 'Approve a KYB application', params: { org_id, notes } },
  { name: 'create_program', description: 'Create a new SCF financing program', params: { anchor_org_id, program_type, credit_limit, rate_apr, payment_terms_days } },
  
  // All portals
  { name: 'get_signal_details', description: 'Get full details on a detected signal', params: { signal_id } },
  { name: 'dismiss_signal', description: 'Dismiss a signal that is not relevant', params: { signal_id, reason } },
  { name: 'query_platform_data', description: 'Query platform data in natural language', params: { query } },
]
```

### T8.10 — Confirmation UI component
Every tool call that writes/creates/updates must show a confirmation card before executing:

```
┌─────────────────────────────────────────┐
│ Strike AI wants to:                     │
│                                         │
│ Create a Strike Place listing           │
│ Product: Stainless Steel Bolts          │
│ Price: $0.85 / unit                     │
│ Quantity: 50,000 units                  │
│ Delivery: 3 weeks                       │
│ Visible to: All buyers on the network   │
│                                         │
│ [Confirm]  [Edit]  [Cancel]             │
└─────────────────────────────────────────┘
```

- Confirmation recorded in `ai_actions_log` with timestamp
- Execution recorded on confirm
- Result (entity created) linked back in the log

### T8.11 — AI system prompt: action agent
```
You are Strike AI — the action agent for [ORG_NAME] on Strike SCF.

You have two modes:
1. ANSWER: Answer questions about the platform, the user's data, and trade finance concepts.
2. ACT: Execute platform actions on behalf of the user using the tools available to you.

Current user: [USER_NAME] ([ROLE])
Organization: [ORG_NAME] (type: [ORG_TYPE])
Portal: [PORTAL]
Current page: [PAGE]
Active signals: [SIGNAL_COUNT] signals require attention

RULES FOR ACTING:
- Always confirm before executing any action that creates, modifies, or sends anything
- Show exactly what will be created/changed before the user confirms
- If the user's request is ambiguous, ask ONE clarifying question before proceeding
- Never execute multiple actions in sequence without confirming each individually
- After executing, tell the user what was done and provide a link to the result

RULES FOR ANSWERING:
- Only reference data explicitly in your context. Never invent figures.
- If data is not available, say so and suggest where to find it.
- Be concise. Use numbers. Give actionable answers.

You know about: [INJECT CURRENT PAGE DATA, ACTIVE SIGNALS, RECENT TRANSACTIONS]
```

### T8.12 — Signal → Chat integration
When user clicks "Take Action" on a signal:
- Opens Strike AI chat tab
- Pre-populates with the signal context: "I noticed [SIGNAL TITLE]. Here's what I can do: [RECOMMENDED ACTION]. Want me to proceed?"
- User can confirm or ask questions before the agent acts
- On confirm: agent calls the appropriate tool, shows confirmation card, executes

### T8.13 — Natural language portfolio queries (bank portal)
Special handling for data query intent — no confirmation required (read-only):
- "Show me all transactions where advance rate > 85% due in the next 30 days" → agent builds the query, returns formatted table
- "Which of my suppliers have PassportScore below 60?" → agent queries, returns ranked list with scores
- "What's my total exposure to retail anchors?" → agent aggregates, returns breakdown
- These use `query_platform_data` tool which hits `/api/ai/query` — a new route that safely translates natural language to filtered DB queries (never raw SQL execution — parameterized only)

---

## TRACK 9 — AI STREAMING + OBSERVABILITY (parallel, lower priority)

> Depends on: Track 1.
> Agent: Solo. Estimated: 4–6 hours.

### T9.1 — Error tracking (Sentry)
- Install `@sentry/nextjs`
- Configure with `SENTRY_DSN` env var
- Wrap all API routes with Sentry error capture
- Add Sentry to `next.config.js`

### T9.2 — Structured logging
- Add `pino` logger to `lib/logger.ts`
- Log: every API request (method, path, user_id, duration), every AI call (tokens used, model, route), every signal detection run (org_id, signals_found)

### T9.3 — AI usage enforcement audit
- `ai_usage` table exists. `ai_limits` table exists with hardcoded fallbacks.
- Verify EVERY AI route actually checks usage before calling Anthropic and increments after
- Routes to audit: `ai/chat`, `ai/insight`, `ai/documents`, `kyb/ai-review`, `deals/extract`, `deals/generate-documents`, `passport/narrative`, `rooms/messages` (moderation)
- If any route skips the check: add it

---

## EXECUTION ORDER

```
NOW (blocking):
  Track 1 — Repo hygiene (T1.1 → T1.5, sequential)

AFTER TRACK 1 (parallel lanes):
  Track 2 — Schema as code          [SOLO AGENT A]
  Track 3 — Testing & CI            [SOLO AGENT B]
  Track 4 — Classic SCF polish      [SOLO AGENT C]
  Track 5 — v2 marketplace/rooms    [SOLO AGENT D]

AFTER TRACK 2 (parallel lanes):
  Track 6 — Passport & network      [SOLO AGENT E]
  Track 7 — ERP integration         [SOLO AGENT F]
  Track 8 — Signal engine + AI      [SOLO AGENT G]

ONGOING:
  Track 9 — Observability           [Any available agent]
```

---

## AGENT OPERATING RULES

1. **Read `apps/web/CLAUDE.md` completely before writing a single line of code.**
2. **One track per agent.** Never two agents in the same file simultaneously.
3. **No agent touches the DB schema directly** — all schema changes go through migration files in `supabase/migrations/`.
4. **All new API routes** follow the existing pattern: `getUser()` → role check → manual scope filter → admin client query → return JSON.
5. **All new pages** follow: `'use client'` → fetch from `/api/` on mount → render in `PortalShell`.
6. **Before completing any task:** run `tsc --noEmit` — it must pass clean. Fix any type errors introduced.
7. **Commit after each completed task** with message format: `[TRACK-X] T{N}.{M}: {description}`
8. **If a task is blocked** (missing dependency, schema gap, unclear spec): stop, write a `BLOCKED.md` note in the repo root with the specific blocker, and move to the next task in the track.

---

## DONE CRITERIA

Phase 2 is shippable when:
- [ ] Track 1 complete (all hygiene issues resolved)
- [ ] Track 2 complete (schema reproducible from repo)
- [ ] Track 5 complete (marketplace realtime + all 3 financing types working)
- [ ] Track 6 complete (PassportScore on behavioral data)
- [ ] Track 8A complete (platform signal engine live, signals surfaced in UI)
- [ ] Track 8C complete (action agent live, confirmation flow working)
- [ ] `tsc --noEmit` passes clean
- [ ] All critical signals tested end-to-end with real data

Phase 2 is complete (investor demo ready) when all 9 tracks are done.

---

## SCHEMA CORRECTIONS (read before writing any code — TASKS.md was generated before live schema was confirmed)

> Live schema confirmed 2026-06-06. These corrections override anything above.

### Tables that exist but TASKS.md didn't know about

**`agent_actions`** — This IS the ai_actions_log. Already has everything needed: `action_type`, `entity_type`, `entity_id`, `reasoning`, `input_summary`, `output_summary`, `outcome`, `requires_approval`, `human_approved`, `approved_by_user_id`, `approved_at`, `model`, `tokens_used`. All of Track 8C should write to `agent_actions`, not create a new table.

**`agent_preferences`** — Stores org-level AI hard limits and rules. This is the "Preference Memory" layer in the ReAct architecture. Columns: `org_id`, `preference_type`, `value` (jsonb), `label`, `is_active`, `set_by_user_id`. Track 8 agents should read from this table when constructing system prompts — these are the hard limits the human has set that the agent cannot override.

**`ai_negotiation_state`** — Tracks live negotiation state per deal. Columns: `deal_id` (unique), `current_round`, `last_offer_snapshot`, `negotiation_history` (jsonb), `agent_recommendation`, `agent_confidence`, `market_context`, `suggested_counter`. Relevant for T5.2 (financing bridge) and T8C (action agent negotiation flow).

**`recommendations`** — Similar to `ai_signals` in purpose but simpler. Has `priority`, `category`, `title`, `body`, `action_label`, `action_url`, `estimated_impact`, `dismissed`, `actioned`. The signal engine (T8.1) should check this table for existing recommendations before creating a duplicate `ai_signals` entry. Consider whether low-severity signals should write to `recommendations` instead of `ai_signals`.

**`room_participants`** — Tracks who has joined which rooms. Columns: `room_id`, `org_id`, `bank_id`, `user_id`, `role`, `joined_at`, `last_read_at`. T5.3 (public room discovery) must use this table for join/membership tracking.

**`room_reports`** — User-reported messages. Columns: `room_id`, `message_id`, `reported_by_user_id`, `reason`, `resolved`, `resolved_by_user_id`, `resolution`. T5.4 (AI moderation) should integrate with this table — flagged messages should create a room_report entry.

**`passport_views`** — Tracks who viewed which passport. Columns: `viewer_org_id`, `viewer_bank_id`, `viewed_org_id`, `context`. T6.3 (passport profile) should write a view record on every profile load.

### Wrong table names in TASKS.md (corrected)

| TASKS.md said | Actual table name |
|---|---|
| `passport_reviews` | `passport_peer_reviews` |
| `ai_actions_log` | `agent_actions` |

### Model discrepancy to fix

`ai_usage` table has `model` column defaulting to `claude-sonnet-4-20250514` but codebase hardcodes `claude-haiku-4-5-20251001`. Fix: update the default in the schema OR ensure all AI routes explicitly pass the correct model string when logging to `ai_usage`. Do not leave them out of sync.

### T2.2 corrected — tables that still need creating

These 4 tables are NOT in the live schema and must be created via migration:
1. `erp_connections`
2. `erp_sync_data`  
3. `ai_signals`
4. `ai_signal_resolutions`

`agent_actions` already exists — do NOT create `ai_actions_log`.
