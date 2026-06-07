# Strike SCF — Complete Project State

> Generated 2026-06-06 from a full codebase sweep. Hand this to a planning agent to produce `tasks.md` for a multi-agent build. This is the single source of truth for "where we are."

---

## 1. What the product is

**Strike SCF** is a Supply Chain Finance (SCF) platform — one Next.js app serving **four portals** off a single `users.role` (portal derived at the server layout, stored in React context):

- **Bank** (`bank_admin`, `bank_credit_officer`) — creates financing programs, reviews KYB, makes credit decisions, approves/disburses financing, monitors risk, sees the supply graph.
- **Anchor / Buyer** (`org_admin`/`org_member` where `organizations.type='anchor'`) — invites suppliers, approves invoices, initiates transactions.
- **Supplier** (`org_admin`/`org_member` where `organizations.type='supplier'`) — submits invoices for early payment.
- **Strike Admin** (`strike_admin`) — platform-level: KYB queue, platform stats, room reports.

It has grown beyond classic SCF into a **v2 "network" product**: a marketplace ("Strike Place"), deal lifecycle ("My Deals"), real-time negotiation ("Strike Rooms"), a trust score ("Strike Passport"), and an embedded AI assistant ("Strike AI"). The v2 layer bridges back into the classic SCF engine (accepting a financing offer spawns a transaction).

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | Turborepo (npm workspaces). `apps/web` is the product; `apps/docs` is a near-empty marketing stub (2 pages). |
| Framework | **Next.js 16.2** (App Router), **React 19.2** |
| Language | TypeScript 5.9 (strict — `tsc --noEmit` currently **passes clean**) |
| DB / Auth / Storage / Realtime | **Supabase** (Postgres + RLS, Auth, Storage buckets, Realtime) |
| AI | **Anthropic API called directly via `fetch`** (no SDK). Model hardcoded to `claude-haiku-4-5-20251001` for all in-app AI (cost-sensitive). Wrapper in `lib/ai.ts`. |
| Email | **Resend** (`lib/email.ts`) |
| Charts | Recharts 3.8 |
| Styling | **Hand-built CSS only** — no Tailwind, no shadcn, no MUI. Tokens in `app/globals.css` + `app/marketplace.css`. 2026 "soft/curved/premium" design system. |
| State | React Context only (no Redux/Zustand). `PortalContext`, `UserContext`. |
| Hosting | Vercel (`vercel.json`), one cron: `/api/risk/refresh-signals` daily at 00:00. |

**Scale:** 85 API routes, 32 portal pages, ~18 shared components, 11 lib modules.

---

## 3. Architecture & conventions (how the code is built)

- **Auth enforcement, two layers that actually run:**
  1. `app/(portal)/layout.tsx` (server component) — `getUser()`, redirects to `/login`, loads the user row + org via admin client, derives portal, wraps children in `PortalProvider`/`UserProvider`/`PortalShell`. **This is the real gate for pages.**
  2. Each API route does `getUser()` inline + role gate + manual scope filter. All **81 API getUser checks** confirmed; **0 routes use `getSession()`** (good).
- **Supabase clients:** anon client (`lib/supabase/server.ts`) only for `getUser()`; **admin/service-role client for all data queries**, always with a manual `.eq()` scope filter because RLS is bypassed by the service role.
- **AI:** `lib/ai.ts` → `callClaude()` + `extractJson()`. 12 routes call Anthropic for real (chat, insight, documents, KYB AI review, deal extract/generate-docs, passport narrative, room moderation, marketplace offer analysis). Usage logged to `ai_usage`; limits from `ai_limits` table with hardcoded fallbacks (chat=50, insight=200, document=20, scoring=500).
- **Pages:** `'use client'`, fetch from `/api/...` on mount, render inside `PortalShell` + `Topbar`. Role-aware grouped sidebar in `components/sidebar.tsx`.

---

## 4. Feature inventory — IMPLEMENTED / WORKING

These have both a built page (substantial LOC) and backing API routes wired up.

### Classic SCF engine
- **Auth flows** — login, signup, forgot/reset password, invite acceptance, pending-approval. `/api/auth/register`.
- **Onboarding wizard** (`(onboarding)/`, 1,186-LOC page + `wizard-context.tsx`) — multi-step KYB intake, document upload, submit. APIs: `onboarding/start|submit|status|progress|documents`. NAICS/countries hardcoded in-page.
- **Programs** — list, detail (1,474 LOC), new-program wizard, bank↔anchor↔supplier drilldown pages. APIs: `programs` CRUD, `[id]/analytics`, `[id]/network` (588 LOC — the biggest non-transaction route), `[id]/invite`, `[id]/bulk-invite`.
- **Transactions** — list, **detail page is the largest file in the repo (3,094 LOC)**, new-transaction wizard (1,279 LOC). Full lifecycle state machine (16 statuses). APIs: `transactions` route (1,490 LOC — biggest API route), `[id]/disburse`, `[id]/repay`, `[id]/documents`. Every status change logged to `transaction_events`.
- **KYB** — review list, per-org review page (785 LOC), decision endpoint, document handling, **AI review** (`kyb/ai-review`, 332 LOC). 
- **Credit decisions** — `credit_scores` + `credit_decision_records`, decision route (293 LOC) with approve/override/more-info/reject + countersign.
- **Collateral** — requirements management page + `collateral` / `collateral/[id]` (356 LOC) routes; lifecycle pending→submitted→approved/rejected/waived/released.
- **Risk scoring** — `risk/score` (4×25pt model), `risk/signals`, daily cron `risk/refresh-signals` (231 LOC) pulling `market_signals`.
- **Dashboard** — role-aware (1,188 LOC) with 4 portal variants. `/api/dashboard` (253 LOC).
- **Reporting / Analytics** — page (668 LOC) + `/api/reporting` (411 LOC) + supply graph (`/api/graph`, `components/supply-graph.tsx`).
- **Invitations** — create/accept/cancel, bank- and anchor-initiated, 3 invitation modes (standard / known_counterparty / custom_kyb).
- **Settings** — profile, bank settings, logo upload, team management (members, role changes, deactivate), **AI Agent preferences** (`settings/agent`, 574-LOC page + route).
- **Notifications** — center + mark-read + read-all, realtime subscription in `portal-shell`.
- **Email** — Resend integration with templates (`lib/email.ts`, `components/email-template.tsx`).

### v2 "network" layer (all currently UNCOMMITTED — see §7)
- **Strike Place (Marketplace)** — hub (545 LOC), listings (create/view, 856 LOC detail), offers (submit/counter/accept/reject, 419-LOC route), financing requests (org + bank sides, 751-LOC detail page; bank offer submission + accept → **spawns an SCF transaction**).
- **My Deals** — deal list, detail (902 LOC, AI doc-gen on `status→agreed`), import flow (670 LOC) with AI document extraction (`deals/extract`). `deal_source: marketplace|imported|direct`.
- **Strike Rooms** — room list + thread (672 LOC) with **realtime messages + AI moderation**. Public + auto-created private rooms.
- **Strike Passport** — score ring + sections components, public profile, peer review submission (519 LOC), `passport/recalculate`, AI narrative. `lib/passport.ts` (209 LOC).
- **Strike AI** — dedicated page (`(portal)/ai/`, 608 LOC) + sliding `ai-panel` + `ai-overlay` + inline `ai-insight` widgets.
- **Strike Admin** — KYB queue, platform stats, room reports moderation.

---

## 5. API route map (85 routes by domain)

```
admin/        kyb (queue + [org_id]), rooms/messages|reports, stats
ai/           chat, insight, documents, usage
auth/         register
collateral/   list, [id]
dashboard/    GET
deals/        list, [id], [id]/documents, [id]/generate-documents, extract, import
documents/    [id]/url (signed URLs)
email/        send
graph/        supply graph
invitations/  list, [token], cancel
kyb/          list, [org_id], [org_id]/decision, [org_id]/documents, ai-review
marketplace/  listings(+[id]), offers(+[id]), financing(+[id], offers, accept)
notifications/ list, [id], read-all
onboarding/   start, submit, status, progress, documents
organizations/ search
passport/     [org_id](+narrative, view), recalculate, reviews(+check)
performance/  [org_id]
programs/     list, [id](+analytics, network, invite, bulk-invite)
recommendations/ list, [id], generate
risk/         score, signals, refresh-signals (cron)
rooms/        list, public, [id](+join, messages)
settings/     profile, bank, logo, agent, team(+members, [user_id])
transactions/ list, [id](+disburse, repay, documents)
```

---

## 6. Database (Supabase Postgres, RLS on all tables)

**~26 tables** (full column list in `apps/web/CLAUDE.md` §"Database schema"). Core: `banks, organizations, users, programs, program_enrollments, transactions, transaction_events, invitations, documents` (single unified table — no separate kyb_documents/collateral file tables), `collateral_requirements, credit_scores, credit_decision_records, supplier_performance, supply_graph_edges, recommendations, bulk_invite_jobs, market_signals, ai_usage, ai_limits, notifications`.

Plus v2 tables implied by code: `marketplace listings/offers, financing requests/offers, deals, rooms, room_messages, peer reviews`.

**Storage buckets required:** `kyb-documents` (private), `deal-documents` (private).

**Realtime enabled on (per docs):** room_messages, notifications, marketplace_offers, financing_request_offers, deals.

### ⚠️ Schema drift — migrations do NOT define the schema
- `supabase/migrations/` contains only **2 files** (`add_invitation_status_values`, `add_deal_source`). The full schema lives in Supabase Studio and is **not reproducible from this repo**. There is **no canonical schema migration**. This is a major reproducibility/onboarding risk.
- `supabase/seed.sql` is **intentionally empty** ("Populate via the platform UI").
- Code references v2 columns **not in the documented schema**: `organizations.network_visible` (44 refs), `organizations.passport_score` (97 refs), `deals.deal_source` (6 refs). Schema was extended directly in Studio.

---

## 7. ⚠️ BROKEN / RISK / NEEDS ATTENTION

1. **`apps/web/proxy.ts` is orphaned (dead code).** It's a full auth/redirect middleware (gates unauthenticated access to portal routes + cron-secret on `refresh-signals`), but Next.js only auto-runs a file named **`middleware.ts`**. Nothing imports `proxy.ts`, and there is no `middleware.ts`. **→ This middleware never executes.** Page-level protection still works via `(portal)/layout.tsx`, and API routes self-protect, so the app isn't wide open — but the intended edge-layer protection (and the `CRON_SECRET` gate on the cron route) is **NOT active**. Verify the cron route protects itself internally; otherwise it's unauthenticated. **Fix: rename `proxy.ts`→`middleware.ts` and export `middleware`/`config`.**

2. **The entire v2 feature set is UNCOMMITTED.** 67 modified files + ~30 untracked dirs/files (all of marketplace, deals, rooms, passport, admin, ai pages and routes, `lib/ai.ts`, `lib/passport.ts`, `app/marketplace.css`, etc.) are not in git. Last commit is "login setup". **A huge amount of working code exists only on this machine.** First action for any agent: get this committed on a branch.

3. **No schema as code.** See §6. Can't stand up a fresh environment from the repo. Need a generated baseline migration from the live DB.

4. **Zero tests.** No `.test`/`.spec` files anywhere. No CI test gate. The only quality gate is `tsc --noEmit` + eslint `--max-warnings 0`.

5. **Stale docs in CLAUDE.md:**
   - "Dev seed accounts" (sarah@atlasbank.dev etc.) are listed but `seed.sql` is empty — those accounts don't exist from the repo.
   - The schema block omits the v2 columns the code actually uses (`network_visible`, `passport_score`).
   - Lists old `anchor_admin`/`supplier_admin` roles in one place though v2 uses `org_admin`/`org_member`.

6. **`lib/api-auth.ts` is legacy/unused.** It exports `requireAuth()` (which uses the discouraged `getSession()`), `requireRole`, `requireBankAccess`, `requireOrgAccess` — but **0 API routes import it**. Either adopt it everywhere or delete it; right now it's misleading dead code that contradicts the "never use getSession" rule.

7. **Realtime partially wired.** Docs claim realtime on 5 channels; code only subscribes in 2 places (`rooms/[id]` messages, `portal-shell` notifications). Marketplace/financing/deals realtime is **not actually subscribed in the client** — they likely poll or require refresh.

8. **AI has no streaming.** `callClaude` is a single blocking `fetch` (no SSE). Chat/long doc-gen will feel slow with no token streaming.

---

## 8. NOT implemented / gaps (likely backlog)

- **e-signature** — transaction schema has full esign fields (`esign_document_id/url`, `bank/anchor/supplier_signed_at`, `esign_completed_at`) but there's no esign provider integration; appears UI-stubbed (`passport/[org_id]` has a `/* placeholder — connect flow TBD */`).
- **Real payment/disbursement rails** — `disburse`/`repay` set reference fields but there's no banking/ACH integration (manual reference entry).
- **Test suite + CI** — none.
- **Schema migrations / seed** — none usable.
- **Observability** — no error tracking (Sentry), no structured logging, no analytics.
- **Rate limiting** — `lib/rate-limit.ts` is tiny (22 LOC); confirm it's actually applied to AI/auth routes.
- **Marketplace/financing realtime** — see §7.7.
- **AI streaming** — see §7.8.

---

## 9. Recommended task tracks for a multi-agent build

Suggested parallelizable workstreams (each = one agent lane), ordered by leverage:

1. **Repo hygiene (do first, blocking):** commit the v2 work on a feature branch; rename `proxy.ts`→`middleware.ts` and verify auth/cron gating; generate a baseline schema migration from the live Supabase DB; fix/regenerate `seed.sql`; reconcile CLAUDE.md with actual schema/roles.
2. **Schema-as-code + environments:** canonical migrations, typed DB types generation, reproducible local Supabase.
3. **Testing & CI:** add Vitest/Playwright, wire a GitHub Actions gate (tsc + lint + tests).
4. **Classic SCF polish:** transaction lifecycle edge cases, collateral, credit decision countersign, reporting accuracy.
5. **v2 marketplace/deals/rooms:** finish realtime subscriptions, AI streaming, offer→transaction bridge hardening.
6. **Passport & network:** scoring correctness, recalculation triggers, peer review integrity.
7. **AI platform:** streaming, usage/limits enforcement audit, prompt-injection hardening on room moderation + doc extraction.
8. **Integrations (net-new):** e-signature provider, payment rails, observability.

**Conventions any agent must follow** (from `apps/web/CLAUDE.md` — read it fully): admin client + manual scope filter always; `getUser()` never `getSession()`; hand-built CSS with design tokens only; Haiku model for all AI; import shared types from `packages/types`; never reference non-existent tables (`kyb_documents`, `collateral`); `invitations.anchor_org_id` not `org_id`; `banks.legal_name`/`display_name` not `banks.name`.

---

## 10. One-paragraph executive summary

Strike SCF is a mature, single-app, four-portal supply-chain-finance platform on Next.js 16 + Supabase, with a fully built classic SCF engine (programs, KYB, credit decisions, the 16-state transaction lifecycle, collateral, risk scoring, reporting) **and** an extensive v2 network layer (marketplace, deals, real-time rooms, passport trust score, embedded Anthropic-powered AI). The code compiles clean and is feature-rich (~85 API routes, ~32 pages). The biggest risks are operational, not feature gaps: **the entire v2 layer is uncommitted to git**, the **database schema exists only in Supabase Studio (not as migrations)**, the **`proxy.ts` middleware is orphaned and never runs**, there are **no tests**, and several docs are stale. Net-new feature gaps are e-signature, real payment rails, AI streaming, and full realtime coverage. Fix the repo-hygiene/schema/middleware items first; everything else is incremental.
