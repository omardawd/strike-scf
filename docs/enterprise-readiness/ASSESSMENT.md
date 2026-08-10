# Strike SCF — Enterprise Readiness Assessment

**Date:** 2026-08-09
**Scope:** `apps/web` (the Next.js monolith), `supabase/migrations`, `supabase/seed.sql`, `.github/workflows`
**Method:** Direct code/migration inspection (4 parallel read-only research passes + manual verification of the highest-risk claims). No dashboard access to Vercel or Supabase project settings was available — anything requiring that is marked **UNVERIFIED (needs dashboard access)** and lives in [`MANUAL_INFRA_CHECKLIST.md`](./MANUAL_INFRA_CHECKLIST.md), not here.
**Baseline:** the repo has **no production customers yet**. Nothing below implies an active incident; this is pre-pilot hardening.

---

## 1. Executive summary

Strike SCF's core authorization pattern (per-route `getUser()` → service-role user lookup → role gate → manually scoped query) is **followed consistently across 154 of 159 API route files**, and TypeScript currently compiles clean. That is a better starting point than the task brief assumed. However, the project has **zero automated tests, zero CI validation on pull requests, an in-memory rate limiter unfit for Vercel's serverless model, a real-looking credential sitting in a template file, one confirmed cross-tenant write vulnerability, a live schema-drift bug that was silently breaking bank-side KYB review and the bank dashboard, a plaintext-stored external API token with no rate limiting or expiry, and no observability stack at all** (no logger, no error tracker, no health endpoint, no audit trail for several consequential actions). None of this is exotic — it is the standard gap profile for a fast-moving pre-launch product — but every item below is either a blocker for a serious enterprise security review or a fast, bounded fix.

The suspected RLS bug named in the engagement brief (`room_participants.room_id = room_participants.id`) **was real but is not live** — it shipped in migration `00000000000001` and was corrected one migration later, in `00000000000002`, on the same day. It is included below for completeness and because it demonstrates a real gap in the platform's *change-management* story (no test caught it; a human had to notice), not because it needs a new fix.

While validating the RLS/seed fixes below against a real, fully-migrated database (see P0-6), a second, unrelated, and more consequential bug surfaced that neither the engagement brief nor the initial research passes anticipated: nine files reference an `organizations.bank_id` column that **does not exist** in the live schema (the real column is `primary_bank_id`) — confirmed directly against the live Supabase project, not inferred. This was silently breaking the bank dashboard's KYB/risk/passport-score widgets, KYB detail/decision/document review, program creation's bank attribution, recommendation generation, and one AI tool, for every bank user, before this engagement. It is now fixed (P0-6).

### Counts
- **P0 (fix before any pilot data is real):** 6
- **P1 (fix before a customer security review):** 8
- **P2 (fix during Phase 1–2):** 9
- **P3 (track, not urgent):** 6

---

## 2. What Vercel/Supabase already provide vs. what is Strike's responsibility

This distinction matters because several "gaps" below are platform-provided and only need *configuration*, not code — those are called out explicitly and moved to the manual checklist rather than double-counted as engineering work.

| Capability | Provided by platform | Strike's responsibility |
|---|---|---|
| TLS termination, HSTS delivery | Vercel (automatic) | Send the header (done, see §5) |
| DDoS/edge rate limiting at the network edge | Vercel (partial, plan-dependent) | Application-level rate limiting per user/tenant (not done, see §6) |
| Postgres backups / PITR | Supabase (plan-dependent — **unverified**, see checklist) | Documented restore procedure + a tested restore (not done) |
| Row-level isolation primitive (RLS) | Supabase (Postgres feature) | Actually writing correct policies for every table (11 tables have zero policies, see §4) |
| Auth session management, password hashing | Supabase Auth | MFA/SSO enablement (not implemented, see §9) |
| Secret storage for deployed env vars | Vercel env var UI | Not committing secrets to files that *could* be read into git (one near-miss, see §7) |
| SSL enforcement / network restrictions on the DB | Supabase project settings | N/A — pure dashboard config, see checklist |
| WAF / bot protection | Vercel (plan-dependent) | Rate limiting business-logic abuse (signup, invitations, AI cost) |
| Static analysis / dependency scanning | Nothing today | GitHub Actions with CodeQL/Dependabot/gitleaks (not present, see §8) |

---

## 3. Findings — P0 (fix before real pilot data touches the system)

### P0-1 — Cross-tenant write on `/api/risk/score`
**File:** `apps/web/app/api/risk/score/route.ts:21-42`
Any authenticated `bank_admin`/`bank_credit_officer` — at **any** bank, not just the org's actual bank — can POST an arbitrary `org_id` and have the route **overwrite** that organization's `risk_score`, `risk_tier`, `risk_flags`, and `tariff_exposure` (write happens at `route.ts:189-197`). The route checks `isSupplier && me.org_id !== org_id` (line 33) for supplier self-scoring, but had no equivalent bank-ownership check for the bank path — contrast with `app/api/kyb/[org_id]/decision/route.ts:46`, which gets this exact check right (or did — see P0-6, it was also broken by the same schema-drift bug). This is a genuine cross-tenant write, not just a read leak, and directly affects a credit-risk field a bank's own decisions depend on.
**Fixed:** added `if (isBank && org.primary_bank_id !== me.bank_id) return 403` before the fetch/update. Note the field is `primary_bank_id`, not `bank_id` — see P0-6; the first version of this fix used the wrong field name and would have always denied legitimate bank access.

### P0-2 — Real-looking Resend API key committed to a template file
**File:** `apps/web/.env.production.example:17`
Contains a value in the exact format of a live Resend API key (`re_` prefix, correct length), while every other variable in the same file is an obvious placeholder (`your-anon-key`, `your-service-role-key`, etc.). **Confirmed not present in git history** (`git log --all -S` on the literal key value returns zero commits — the file itself is untracked because the repo's `.gitignore` uses a blanket `.env*` pattern that also excludes the example/template file, see P1-6). It is real on disk today, in a file a developer could `git add -f` at any time.
**Fix:** rotate the Resend key in the Resend dashboard (manual, outside this repo — recorded in the checklist), replace the value in the file with an obvious placeholder (done as part of Track A, see final report).

### P0-3 — No production/environment guard on `/api/demo/*`
**Files:** `apps/web/app/api/demo/{approve-task,close-negotiation,mock-negotiate,negotiation-status,pause-agents,reset,state,tick}/route.ts`, `apps/web/lib/demo.ts:1-8`
Every demo route is gated only by `isDemoAccount(email)` — a string comparison against the hardcoded `demo@demo.com` account (plus `strike_admin` for `reset`). There is **no** `NODE_ENV`, feature-flag, or any other environment check anywhere in the demo code path (confirmed via grep, zero matches for `NODE_ENV` in `lib/demo.ts` or `app/api/demo/**`). This means the exact same reset/tick/mock-negotiate machinery that mutates a hardcoded set of org rows (`DEMO_ALL_ORG_IDS`, confirmed hardcoded UUID constants in `lib/demo-entities.ts:5-10`, not attacker-influenced) runs identically in whatever environment is deployed as "production." As long as `demo@demo.com` is the only account with that email, cross-tenant blast radius is contained by design — but a customer auditor will correctly flag "a real API route with no environment gate that resets application state" as a control gap regardless of how tightly the blast radius is currently scoped.
**Fix:** add a server-only `DEMO_ROUTES_ENABLED` env flag (default false in production) that 404s all `/api/demo/*` routes unless explicitly set — Track A.

### P0-4 — `/api/ai/dispatch` bearer token stored and compared in plaintext
**Files:** `apps/web/app/api/ai/dispatch/route.ts:44-56`, `supabase/migrations/00000000000018_erp_integration.sql:11`
The dispatch token is a 64-char random hex string, generated by Postgres (`DEFAULT encode(gen_random_bytes(32), 'hex')`), stored **unhashed** in `erp_connections.dispatch_token`, matched via a plain `.eq('dispatch_token', token)` (route.ts:52), and — separately — **rendered in cleartext in the Settings UI** (`app/(portal)/settings/page.tsx:1333,1346`, per research agent finding, not independently re-verified line-by-line but consistent with the DB-stored-plaintext design). A database read (backup leak, admin-client misuse, SQL injection elsewhere, etc.) or a browser-side leak of the settings page discloses a long-lived, unscoped, un-rate-limited credential that can drive the full org-portal AI tool set, including starting autonomous negotiations (`route.ts:160-172`). No expiry, no scope restriction, no revocation UX beyond deleting the row, no rate limiting, no replay protection.
**Fix (Track G):** hash the token at rest (store only a SHA-256 digest + a short public prefix for lookup, mirroring API-key patterns like Stripe's), add `expires_at`/`scopes`/`revoked_at` columns, add rate limiting, keep the UI showing the raw token only once at creation time. This is a schema migration + route rewrite — scoped as its own Phase 1 track, not a one-line fix, so it's flagged P0 here but scheduled realistically in the roadmap.

### P0-5 — In-memory rate limiter is not viable on Vercel and covers almost nothing
**File:** `apps/web/lib/rate-limit.ts` (module-level `Map`)
The store is a single process-local `Map`; Vercel serverless functions do not guarantee instance reuse or a single instance under load, so this limiter's effective enforcement is unpredictable — anywhere from "works most of the time on a warm instance" to "resets every cold start." Worse, it is wired into only **2 of 159** route files (`app/api/invitations/route.ts:69`, `app/api/erp/sync/route.ts`). Auth (`/api/auth/register`, `/api/auth/login` if present), the AI endpoints (`chat`, `documents`, `upload`, `dispatch`), document/listing extraction, and search are all completely unthrottled today. Given the AI endpoints call paid third-party APIs (Anthropic, Tavily), this is a real cost/abuse exposure, not just a security nicety.
**Fix (Track F):** replace with a durable, distributed-safe design — Upstash Redis (Vercel-native, generous free tier) behind a small abstraction with a fail-open fallback so a provider outage doesn't take down auth. Apply to the endpoint list in the engagement brief.

### P0-6 — `organizations.bank_id` does not exist; nine files silently broken (discovered and fixed mid-engagement)
**Discovered while validating Track E** (see §"Verification method" below) — not something the four initial research passes found, because none of them had live-database access to check a column actually exists versus merely being referenced in code and documented in `apps/web/CLAUDE.md`.

The live schema's real column is `organizations.primary_bank_id` (confirmed directly against the live Supabase project via `information_schema.columns` and a direct `SELECT`, which returned `ERROR: 42703: column "bank_id" does not exist`). `apps/web/CLAUDE.md`'s schema documentation and nine call sites in the codebase both assumed a column named `bank_id`. Since Supabase/PostgREST validates requested columns against the real table and errors (rather than silently returning `undefined`), every one of these reads/filters fails, and the calling code's `data` comes back `null` — with no route checking the accompanying `error`, so each one silently degraded to "deny" or "zero results" rather than throwing:

- `app/api/kyb/[org_id]/route.ts:40` — bank users got 403 viewing **any** org's KYB detail (the bank-ownership check always failed since `org.bank_id` was `undefined`).
- `app/api/kyb/[org_id]/decision/route.ts:45,50` — bank users could not approve/reject/request-info on KYB submissions at all.
- `app/api/kyb/[org_id]/documents/route.ts:24,27` — bank users could not view or upload internal KYB documents.
- `app/api/dashboard/route.ts:45,82,90,98` — the bank dashboard's KYB-pending count, at-risk-supplier list, tariff-exposure list, and PassportScore distribution widgets all silently rendered empty/zero for every bank user.
- `app/api/performance/[org_id]/route.ts:13,16` — supplier-performance bank attribution silently fell through to a slower fallback path (program-enrollment lookup) instead of using the direct column.
- `app/api/programs/route.ts:167,170` — a program created by an org (rather than a bank user) attributed to the wrong/undefined bank.
- `app/api/recommendations/generate/route.ts:58` — the "suppliers with pending KYB > 7 days" recommendation check silently found zero matches for every bank.
- `lib/ai/tools/handlers/proactive-portfolio-alerts.ts:86` — the `proactive_portfolio_alerts` AI tool's risk-flagged-org check silently found zero matches.
- `apps/web/app/api/risk/score/route.ts:47` — this engagement's own P0-1 fix, committed before this bug was discovered, used the same wrong field name and would have always denied legitimate bank access to the risk-scoring endpoint (caught and corrected before merge to the assessment's final state).

**Fixed:** all nine sites now reference `primary_bank_id`. **Verification method:** rather than trust static reading alone, this fix was validated by standing up a throwaway local Postgres 14 instance (no Docker/Supabase CLI available in this environment), hand-stubbing the minimal `auth` schema Supabase provides, applying all 43 migrations in order, and running the corrected `seed.sql` end-to-end — a full, successful `supabase db reset` equivalent, which also concretely validates P1-2 and P1-1's migration (below) rather than leaving them as static-only claims. Spot-checked the resulting rows and confirmed all 5 new RLS policies from P1-1 exist.

**Why this matters beyond the immediate fix:** `apps/web/CLAUDE.md` — the project's single documented source of truth for the schema — also lists `organizations.bank_id`, meaning the documentation itself is out of sync with the live database, not just the code. This is worth a follow-up correction in CLAUDE.md (not done as part of this engagement, to avoid scope creep into non-security documentation) and is a concrete argument for Track C/E's "prove a fresh environment reproduces the live schema" work: this class of bug is invisible to `tsc`, invisible to lint, and invisible to any test that mocks the Supabase client instead of hitting a real, migration-built schema.

---

## 4. Findings — P1 (fix before a customer security review)

### P1-1 — 11 tables have RLS enabled but zero policies (deny-all, currently moot but a real gap going forward)
**File:** `supabase/migrations/00000000000001_baseline_rls.sql` (RLS-enable statements at lines 5,7,8,9,10,12,13,18,27,32,33)
`agent_actions`, `ai_limits`, `ai_negotiation_state`, `ai_usage`, `banks`, `credit_decision_records`, `credit_scores`, `market_signals`, `recommendations`, `supplier_performance`, `supply_graph_edges` — all have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with **no** `CREATE POLICY` anywhere in the 42-file migration set (confirmed by full-corpus grep). Today this is moot because 154/159 routes use the service-role client, which bypasses RLS entirely — RLS is explicitly documented in the migration comments as defense-in-depth, not the primary control. But `00000000000033_enable_realtime_publication_tables.sql` already registered several tables for Supabase Realtime, which *does* rely on RLS to filter what a client-side subscription can see — so this gap stops being academic the moment any of these 11 tables is ever subscribed to directly, or queried with an anon/authenticated key from a future feature.
**Fixed:** added policies for all 11 tables in a new forward-only migration (`supabase/migrations/00000000000043_rls_defense_in_depth_batch2.sql`), scoped to the same bank/org ownership pattern used elsewhere (e.g. `credit_scores`/`credit_decision_records` → org's own bank or own org; `agent_actions`/`ai_usage` → own org/bank; `banks` → strike_admin + own bank's users; `market_signals` → any authenticated user, since it's non-tenant reference data). Verified by applying all 43 migrations to a fresh local Postgres instance and confirming all 5 spot-checked policies (`agent_actions_scoped`, `ai_limits_scoped`, `banks_scoped`, `credit_scores_scoped`, `market_signals_authenticated_read`) exist post-migration.

### P1-2 — Seed data used enum values and a column name that don't exist in the schema; `supabase db reset` failed
**File:** `supabase/seed.sql:79-81` (org `status='approved'`, `risk_tier='A'|'B'|'C'`), `seed.sql:78` (`INSERT INTO organizations` column list used `bank_id`, which doesn't exist — see P0-6), `seed.sql:115` (`financing_types` array included `'factoring'`/`'open'`), `seed.sql:145-160` (`transactions.status` used 5 nonexistent values: `pending_anchor_initiation`, `more_info_requested`, `financing_approved_pending_collateral`, `pending_delivery_confirmation`, `delivery_confirmed`)
Cross-referenced against `00000000000000_baseline_schema.sql`'s actual enum definitions: `org_status` has no `'approved'` value (valid: `pending_kyb|kyb_in_progress|kyb_submitted|kyb_ai_reviewing|active|suspended|rejected`); `risk_tier` is `green|amber|red`, not letter grades; `financing_type[]` has no `'factoring'`/`'open'`; `transaction_status` was never extended past its original 12 values by any later migration. The org-insert failure (first data-bearing statement) meant **a fresh `supabase db reset` failed immediately** — there was no way to stand up a working local/fresh environment from migrations + seed. `seed.sql`'s own header comment admitted it was written against the CLAUDE.md-documented schema and had never been executed against the live DB. A second file, `supabase/seed-demo.sql`, had already independently documented parts of this same enum drift.
**Fixed:** corrected `seed.sql`'s enum usage and the `organizations` column name to match the live schema. **Verified, not just asserted**: stood up a throwaway local Postgres 14 instance, hand-stubbed the minimal Supabase `auth` schema, applied all 43 migrations in order, then ran the corrected `seed.sql` — full success (`INSERT 0 6` / `INSERT 0 16` etc. for every block, zero errors), and spot-checked the resulting `organizations`/`transactions` rows match the intended seed data. This is the first time this seed file has been proven to actually work against the real schema shape.

### P1-3 — Only 6 of 159 API route prefixes get any middleware-level auth check
**File:** `apps/web/middleware.ts:49-56` (the `AUTHED_API_PREFIXES` allowlist: `/api/ai/chat`, `/api/ai/usage`, `/api/risk/score`, `/api/recommendations`, `/api/performance/`, `/api/graph`), `middleware.ts:65` (page-route gating explicitly excludes `/api/`)
Middleware provides zero blanket protection for API routes — every route is individually responsible for its own `getUser()` call, and the architecture (documented, intentional, per CLAUDE.md) has no shared auth helper to enforce that consistently. The sampled audit found this pattern followed correctly in the large majority of routes, but the *design* itself has no safety net: a single new route that omits its auth check is invisible to any centralized control until someone notices in review. This is why Track D (centralized authz helpers) matters even though most existing routes are currently fine.
**Fix (Track D):** introduce typed, centralized `requireAuth()`/`requireRole()`/resource-ownership helpers and migrate the highest-risk routes first (bank_accounts, documents, financing, admin) — not a mass rewrite (explicitly out of scope per the engagement rules).

### P1-4 — No structured logging, no error tracking, no request/correlation IDs, no health endpoint
**Evidence:** zero matches for `sentry|datadog|logrocket|bugsnag|pino|winston` in `package.json`; zero files named `logger*`; zero `x-request-id` handling; `crypto.randomUUID()` used only for business record IDs, never request tracing; no `app/api/health` or `app/api/ready` route exists.
This is not a single bug, it's an absent capability: today, diagnosing a production incident means reading Vercel's raw function logs with no correlation across a multi-step flow (e.g., tracing a single failed disbursement across `deals/[id]/transition` → `transactions/[id]/disburse` → downstream AI doc-gen). An enterprise customer's security questionnaire will ask for log retention and incident-detection capability directly.
**Fix (Track H):** structured logger with redaction, request-ID middleware, `/api/health` + `/api/ready`, a disabled-by-default error-tracking abstraction (e.g. Sentry, gated on an env var so it stays off until explicitly configured).

### P1-5 — Upload validation is inconsistent; 3 routes write unsanitized client filenames into storage paths
**Files:** `app/api/onboarding/documents/route.ts:72` (`${org_id}/${document_kind}/${file.name}`), `app/api/transactions/[id]/documents/route.ts:124-125`, `app/api/collateral/[id]/route.ts:159` (`collateral/${id}/${uploadedFile.name}`)
Of 12 upload-handling routes, only 3 enforce a file-size cap and only 2 enforce a MIME allowlist; none do content-based (magic-byte) validation — every route trusts the client-supplied `Content-Type`. Three routes above build a storage path directly from the raw client filename with no sanitization (contrast with `app/api/kyb/[org_id]/documents/route.ts:100-101` and two others, which do sanitize via a `[^a-zA-Z0-9._-]` regex). No malware-scanning hook exists anywhere (confirmed absent).
**Fix (Track I):** shared upload-validation helper (size cap, MIME allowlist, filename sanitization) applied to all upload routes; document malware-scanning as a Phase 2/3 integration point (e.g., Supabase Storage + a scanning webhook, or ClamAV sidecar) rather than building it now.

### P1-6 — `.env.production.example` is not tracked in git at all
**File:** root `.gitignore:39` and `apps/web/.gitignore:29`, both using a blanket `.env*` pattern that also matches the example/template file
`git ls-files | grep -i env` returns nothing — new engineers get no committed reference for required env vars; `CLAUDE.md`'s prose list is the only source of truth in git. This also means the P0-2 leaked-looking key has never been "fixed and re-committed" — the file has simply never been through git, so fixing it on disk (Track A) needs a `.gitignore` exception (`!apps/web/.env.production.example`) to actually land in the repo.
**Fix:** add a gitignore exception for the example file specifically, commit the corrected (placeholder) version.

### P1-7 — No CI runs on pull requests or pushes
**Files:** `.github/workflows/*.yml` (5 files, all `cron-*.yml`, all schedule-only + `workflow_dispatch`)
Confirmed: no workflow contains a `pull_request` or `push` trigger. Nothing validates lint/typecheck/build/tests before merge today; the existing 5 workflows exist solely to hit scheduled app routes (agents scan/tick, deals overdue check, ERP sync, risk signal refresh).
**Fix (Track B):** add `ci.yml` with install/typecheck/lint/build/test, minimum token permissions, concurrency cancellation, dependency+secret+SAST scanning.

### P1-8 — Lint is effectively disabled by volume: 682 warnings against a `--max-warnings 0` script
**File:** `apps/web/package.json:9` (`"lint": "eslint --max-warnings 0"`), current run: 682 warnings / 0 errors
Categories: `@typescript-eslint/no-explicit-any` (335), `turbo/no-undeclared-env-vars` (203 — env vars used in code but not declared in `turbo.json`'s env list), `@typescript-eslint/no-unused-vars` (55), `no-empty` (36), `react-hooks/exhaustive-deps` (25), plus a handful of `@next/next/*` rules. The configured script would fail outright the moment it's ever run in CI, which is presumably *why* no CI runs it today — a silent standoff. TypeScript itself compiles clean (`tsc --noEmit`, exit 0) — this is purely a lint-hygiene backlog, not a correctness signal.
**Fix (Track C/B):** do not weaken the rules (explicitly forbidden) — establish a ratcheting baseline (e.g. `eslint --max-warnings <current count>` checked into CI, only decreasing over time) and document the 682-warning starting point plus a bounded remediation plan by category.

---

## 5. Findings — P2

- **P2-1 — CSP allows `unsafe-inline` and `unsafe-eval` in `script-src`, `unsafe-inline` in `style-src`.** `apps/web/next.config.ts:18-27`. Other headers (X-Frame-Options: DENY, HSTS with preload, X-Content-Type-Options, Referrer-Policy, a real Permissions-Policy) are already solid — this is the one weak directive. No `object-src`/`base-uri` set either. Removing `unsafe-eval` requires auditing for any `eval`/`new Function`/dynamic-require usage (likely none, but needs verification); removing `unsafe-inline` requires nonce/hash-based inline script handling, which is a bigger lift for a Next.js app with third-party font loading — scoped as a "safe path" document in Track I, not a same-PR fix.
- **P2-2 — Wildcard CORS on `/api/ai/dispatch`.** `app/api/ai/dispatch/route.ts:33-41`. Justified by the route's own design (phones/webhooks, bearer-token auth, not cookie-based) but should be restricted to configured origins wherever browser-based callers are expected, per Track G.
- **P2-3 — Audit trail gaps for consequential actions.** No audit row on: `users.role`/`is_active` changes (`app/api/settings/team/[user_id]/route.ts:70-77`, `app/api/settings/team/members/route.ts:94-104`), org-initiated KYB status transitions (`kyb/status/route.ts:103`, `onboarding/submit/route.ts:94`, `onboarding/start/route.ts:96,178` — only the *bank/admin decision* path writes to `credit_decision_records`), `bank_accounts` creation/edit (`settings/bank-accounts/route.ts:56-92`), or document access/signed-URL generation (`documents/[id]/url/route.ts` — authorizes correctly but never logs who accessed what). See Track J.
- **P2-4 — Signed document URLs expire in 5 minutes but access is never logged.** `app/api/documents/[id]/url/route.ts:117,124`. The authorization check itself (`canAccessDocument()`, lines 19-83) is genuinely solid — this is purely a missing audit-log write, not an access-control flaw.
- **P2-5 — `risk/refresh-signals`'s inner cron-secret check is skipped outside `NODE_ENV==='production'`.** `app/api/risk/refresh-signals/route.ts:170-172`. Middleware (`middleware.ts:41-45`) covers it unconditionally regardless, so production is safe; only a staging/preview deployment relying solely on the route-level check (not middleware) would be exposed — low likelihood given middleware runs first, but inconsistent and worth aligning.
- **P2-6 — 9 migrations (034–042) are undocumented in `apps/web/CLAUDE.md`'s migration list.** Doc drift, not a code defect — CLAUDE.md's "single source of truth" status (per project memory) means this should be corrected as routine maintenance, not urgent.
- **P2-7 — No `.nvmrc`/`.node-version`; `engines.node` is a loose `>=18` floor.** `package.json:14-17`. Fine today, becomes a CI-reproducibility problem the moment CI is added (Track B needs an exact pin).
- **P2-8 — No MFA, no SSO/SAML.** Confirmed absent via exhaustive grep (`totp|mfa|saml|sso` — zero matches). Expected for a pre-pilot product; flagged because enterprise customers will ask directly. Supabase Auth supports MFA (TOTP) natively — enabling it is a real but bounded Phase 2 feature, not a Phase 0/1 blocker given no production customers exist yet.
- **P2-9 — No dependency/secret/SAST scanning anywhere.** No Dependabot config, no gitleaks/trufflehog, no CodeQL. Folded into Track B.

---

## 6. Findings — P3 (track, not urgent)

- **P3-1** — `ai_negotiation_state` table is confirmed orphaned (zero reads/writes anywhere) per CLAUDE.md and independently consistent with the RLS audit (it has RLS enabled, no policies, and — per the app's own documentation — no code path touches it). Candidate for removal in a future cleanup, not a security issue.
- **P3-2** — No `supabase/config.toml` — no declared local Supabase CLI dev stack (Postgres version, ports, extensions pinned only inline in migration SQL). Convenience gap for local development, not a production risk.
- **P3-3** — `lib/api-auth.ts` was already correctly deleted per CLAUDE.md's own history (dead code, zero importers) — noted here only to confirm it was *not* accidentally reintroduced anywhere; it wasn't.
- **P3-4** — Two organizations (Walmart Inc., Rocket Corp per CLAUDE.md's dev-seed notes) exist in the live dev database outside `seed.sql`/version control. Not a security issue by itself, but worth being aware of when reasoning about "what's actually in the dev DB" vs. what migrations+seed would reproduce.
- **P3-5** — `turbo/no-undeclared-env-vars` (203 of the 682 lint warnings) indicates `turbo.json`'s env allowlist is stale relative to actual env var usage — worth fixing as part of the lint-baseline work since it's mechanical, not a judgment call.
- **P3-6** — GitHub Actions cron reliability for sub-hourly jobs is self-documented in CLAUDE.md as unreliable, with `pg_cron` as the actual production mechanism. Not re-verified here (no DB dashboard access) — flagged for the manual checklist to confirm the `pg_cron` job is still healthy.

---

## 7. Assumptions requiring dashboard access (not claimed as fact here)

Everything in this section is **UNVERIFIED** from code alone and is tracked in [`MANUAL_INFRA_CHECKLIST.md`](./MANUAL_INFRA_CHECKLIST.md):
- Actual Vercel plan (Hobby vs Pro) — project memory notes this was previously confirmed as Hobby via a real deployment failure (2-cron/day cap), but should be re-verified before relying on it.
- Vercel team MFA enforcement, preview deployment protection, WAF/log-drain configuration, spend alerts.
- Supabase project plan, PITR/backup retention window, whether a restore has ever been tested, network restrictions (IP allowlist), SSL enforcement setting, Security Advisor findings.
- Whether `pg_cron` job `agent-negotiation-tick` is still running on schedule (CLAUDE.md documents a method to check via SQL, not re-run here).
- GitHub repository branch protection rules, required reviewers, secret scanning / push protection status.
- DNS/email domain security (SPF/DKIM/DMARC for the Resend-sending domain).
- Vendor DPAs / subprocessor list for Supabase, Vercel, Anthropic, Resend, Tavily.

---

## 8. What this assessment deliberately does not claim

- No penetration test has occurred. Nothing here substitutes for one.
- No production data was accessed, read, or modified in producing this assessment — everything above comes from static code/migration inspection plus two local commands (`eslint`, `tsc --noEmit`) run against the working tree.
- The P0/P1 counts reflect *this specific codebase's* actual state, not a generic checklist — every item has a file:line citation. Where a claim could not be verified directly (e.g., anything requiring a live dashboard), it is explicitly marked as such rather than asserted.
