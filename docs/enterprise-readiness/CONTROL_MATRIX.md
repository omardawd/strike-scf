# Strike SCF — Control Matrix

Companion to [`ASSESSMENT.md`](./ASSESSMENT.md) and [`ROADMAP.md`](./ROADMAP.md). Status reflects the repository as of 2026-08-09, on `codex/enterprise-readiness`, **before** Phase 0/1 implementation lands — this file will be updated as tracks complete (see the final engagement report for what actually shipped).

Status legend: 🟢 Implemented & evidenced · 🟡 Partially implemented · 🔴 Not implemented · ⚪ Config-only (owned outside code, see `MANUAL_INFRA_CHECKLIST.md`)

---

## Access control

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Per-route authentication (`getUser()`) | Unauthenticated data access | Inline in 159/159 route handlers per CLAUDE.md's documented pattern; zero `getSession()` usage confirmed | None today; Phase 1.C adds unauthenticated-access tests | Eng | 🟡 |
| Role gating | Privilege escalation across roles | Inline role-array checks (`BANK_ROLES`, `ORG_ROLES`, `strike_admin`) per route | None today; Phase 1.C adds role-enforcement tests | Eng | 🟡 |
| Centralized authz helpers | Inconsistent/missing checks in new routes | None exist today (`lib/api-auth.ts` deliberately deleted, never replaced) | N/A | Eng | 🔴 → Phase 1.D |
| MFA | Credential-stuffing / account takeover | Not implemented; Supabase Auth supports TOTP natively but unused | N/A | Eng + Product | 🔴 → Phase 2 |
| SSO/SAML | Enterprise IdP integration | Not implemented | N/A | Eng + Product | 🔴 → Phase 2+ |
| Session management | Session fixation/hijack | Delegated entirely to Supabase Auth (`@supabase/ssr`) | ⚪ Supabase-managed | Supabase | ⚪ |

## Tenant isolation

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Manual `.eq()` scoping on service-role queries | Cross-tenant read/write via admin client | Present in the large majority of the 154 routes using the admin client (sampled and confirmed) | None automated; Phase 1.C adds the tenant-isolation matrix | Eng | 🟡 |
| `/api/risk/score` bank-tenant check | Cross-tenant write of risk data | **Missing today** — confirmed P0-1 finding | Fix + regression test in Phase 0.3 / 1.C | Eng | 🔴 → 🟢 (Phase 0) |
| RLS as defense-in-depth | Cross-tenant access if service-role scoping is ever missed, or via Realtime/anon-key access | Enabled and policies present on all 45 tables as of migration `00000000000043` (was 34/45; the 11-table gap is closed) | Verified by full migration replay against a fresh local Postgres instance; no automated pgTAP tests yet — Phase 1.E/1.C | Eng | 🟢 (needs tests) |
| Live schema matches code/docs | Silent authorization/functional failures from a column/table that code assumes exists but doesn't | **Was broken** — `organizations.bank_id` doesn't exist (real column: `primary_bank_id`); fixed across 9 call sites (see ASSESSMENT.md P0-6). No automated check prevents this recurring today | Phase 1.C's local/ephemeral-Supabase test target is the automated backstop; not yet wired into CI | Eng | 🟡 (fixed, no regression guard yet) |
| `canAccessDocument()` centralized IDOR check | Arbitrary document access via signed URL | Implemented, `app/api/documents/[id]/url/route.ts:19-83`, covers organization/deal/listing/financing_request entity types | None automated; add in Phase 1.C | Eng | 🟢 (needs tests) |
| Network visibility filtering | Cross-network listing/financing-request leakage | `lib/networks/visibility.ts` — single source of truth, applied at API layer per listing/financing browse route (per CLAUDE.md) | None automated; add in Phase 1.C | Eng | 🟡 |

## Change management

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| PR-triggered CI (typecheck/lint/build/test) | Regressions merged without validation | **None exists** — 5 GitHub Actions workflows are all schedule-only cron triggers | N/A | Eng | 🔴 → Phase 1.B |
| Branch protection / required reviews | Direct pushes to main, unreviewed merges | Unknown — requires GitHub settings review | ⚪ | Eng lead | ⚪ UNVERIFIED |
| Forward-only migrations (no editing applied migrations) | Schema drift between environments | Followed consistently — 42 sequential migration files, no evidence of edits to already-numbered files | Migration-order test in Phase 1.E | Eng | 🟢 |
| Deployment approval gate | Unreviewed production deploys | Unknown — Vercel project settings | ⚪ | Eng lead | ⚪ UNVERIFIED |
| Rollback procedure | Inability to recover from a bad deploy | Not documented today | `docs/runbooks/PRODUCTION_ROLLBACK.md` (Phase 1.K) | Eng | 🔴 → 🟡 (doc only; Vercel rollback capability itself is platform-provided) |

## Vulnerability management

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Dependency scanning | Known-vulnerable packages | Not configured (no Dependabot config found) | N/A | Eng | 🔴 → Phase 1.B |
| Secret scanning (repo) | Committed credentials | Not configured in-repo; GitHub's platform-level secret scanning status unknown | ⚪ + 🔴 | Eng + GitHub org owner | 🔴 / ⚪ UNVERIFIED |
| SAST | Injection/XSS/logic bugs at commit time | Not configured | N/A | Eng | 🔴 → Phase 1.B |
| Lint as a quality gate | Code-quality regressions | Configured (`--max-warnings 0`) but **not enforced anywhere** (no CI runs it); 682 existing warnings would fail it immediately | Ratcheting baseline planned, Phase 1.B/C | Eng | 🔴 (present but inert) |

## Logging & monitoring

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Structured application logging | Inability to diagnose/investigate incidents | Not implemented — `console.*` only, no logger module | N/A | Eng | 🔴 → Phase 1.H |
| Error tracking | Silent production failures | Not implemented — no Sentry/equivalent dependency | N/A | Eng | 🔴 → Phase 1.H |
| Request/correlation IDs | Cross-service tracing of a single request | Not implemented | N/A | Eng | 🔴 → Phase 1.H |
| Health/readiness endpoints | Uptime monitoring, deploy verification | Not implemented — no `/api/health` or `/api/ready` | N/A | Eng | 🔴 → Phase 1.H |
| Platform-level function logs | Baseline operational visibility | Vercel's own function log retention (plan-dependent) | ⚪ | Vercel | ⚪ UNVERIFIED |
| Database logs / Security Advisor | DB-level anomaly detection | Supabase-provided | ⚪ | Supabase | ⚪ UNVERIFIED |

## Incident response

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Documented IR process | Slow/inconsistent response to a real incident | Does not exist today | `docs/security/INCIDENT_RESPONSE.md` (Phase 1.K) | Eng lead | 🔴 → 🟡 (doc only until drilled) |
| Credential-compromise runbook | Slow response to a leaked key/token | Does not exist today | `docs/runbooks/CREDENTIAL_COMPROMISE.md` (Phase 1.K) | Eng lead | 🔴 → 🟡 |
| Security contact / disclosure process | No channel for responsible disclosure | Does not exist today | `SECURITY.md` (Phase 1.K) | Eng lead | 🔴 → 🟢 (doc, Phase 1) |

## Backup & recovery

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Database backups | Data loss | Supabase-provided (plan-dependent) | ⚪ | Supabase | ⚪ UNVERIFIED |
| Point-in-time recovery | Recovery to a specific pre-incident moment | Supabase-provided (plan-dependent, likely Pro+) | ⚪ | Supabase | ⚪ UNVERIFIED |
| Tested restore procedure | Confidence that backups actually work | Not documented or tested | `docs/runbooks/DATABASE_RESTORE_TEST.md` (Phase 1.K, executed in Phase 2) | Eng lead | 🔴 → 🟡 (doc in Phase 1, real drill in Phase 2) |

## Data retention

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Data classification | Mishandling of sensitive fields (bank details, KYB docs) | Not formally documented (implicit in schema design) | `docs/security/DATA_CLASSIFICATION_RETENTION.md` (Phase 1.K) | Eng + Product | 🔴 → 🟡 (doc only) |
| Retention policy | Indefinite storage of sensitive data past need | Not defined | Same doc | Eng + Product + Legal | 🔴 → 🟡 |
| Document storage lifecycle | Orphaned/stale sensitive documents | Not defined | Same doc | Eng | 🔴 |

## Vendor management

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Subprocessor list | Undisclosed data flows to third parties | Not documented today (Supabase, Vercel, Anthropic, Resend, Tavily are the known subprocessors) | `docs/security/SUBPROCESSORS.md` (Phase 1.K) | Eng lead + Legal | 🔴 → 🟢 (doc, Phase 1) |
| DPAs with subprocessors | Legal data-handling obligations | Unknown — requires legal/ops confirmation | ⚪ | Legal/Ops | ⚪ UNVERIFIED |

## AI governance

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Human approval for consequential AI decisions | AI autonomously executing binding financial actions | **Implemented and well-designed** — the two-gate negotiation system (GATE 1 plan approval, GATE 2 finalization approval) is a genuine architectural control, not a stub; `accept_marketplace_offer` is intentionally never given to any AI tool schema | No automated test today; add in Phase 1.C | Eng | 🟢 (needs tests) |
| Guardrail enforcement server-side, not prompt-only | Prompt injection or model drift bypassing limits | `checkPriceGuardrail` validates terms server-side before execution (per CLAUDE.md); hard platform-wide caps (`HARD_MAX_ROUNDS`/`HARD_MAX_DEADLINE_DAYS`) enforced regardless of org config | No automated test today; add in Phase 1.C | Eng | 🟢 (needs tests) |
| AI action audit log | Untraceable AI decisions | `agent_actions` table, written from `/api/ai/tools/execute` and the tick loop; historically lost ~22/26 tool names to a silent enum mismatch until migration 032 (2026-07-19, already fixed) | Partial — no test proving every tool writes an audit row | Eng | 🟡 |
| External dispatch credential security | Compromised token driving AI actions org-wide, indefinitely | **Not implemented** — plaintext token storage, no expiry/scope/revocation (P0-4) | N/A today; Phase 1.G | Eng | 🔴 → Phase 1.G |
| Model/version/provenance documentation on AI decisions | Inability to explain/audit a specific AI decision later | Partially present (`model`, `tokens_used` columns on `agent_actions`/`ai_usage`) but not consistently documented as a governance artifact | `docs/security/AI_GOVERNANCE.md` (Phase 1.K) formalizes this | Eng | 🟡 |

## Business audit trails

| Control | Risk addressed | Implementation | Automated test/evidence | Owner | Status |
|---|---|---|---|---|---|
| Deal lifecycle audit (`deal_events`) | Untraceable deal state changes | Implemented, referenced in 16 files | No automated test today | Eng | 🟢 (needs tests) |
| Transaction lifecycle audit (`transaction_events`) | Untraceable financing state changes | Implemented, referenced in 7 files | No automated test today | Eng | 🟢 (needs tests) |
| Credit/KYB decision audit (`credit_decision_records`) | Untraceable bank decisions | Implemented for the bank/admin decision path only | No automated test today | Eng | 🟡 — see gap below |
| Org-initiated KYB status transitions | Untraceable self-service status changes | **Not audited** — `kyb_status` written directly with no log row in `kyb/status`, `onboarding/submit`, `onboarding/start` | Phase 1.J adds canonical audit schema covering this | Eng | 🔴 → Phase 1.J |
| Role/permission changes | Untraceable privilege changes | **Not audited** — `users.role`/`is_active` updates have no log write | Phase 1.J | Eng | 🔴 → Phase 1.J |
| Bank account detail changes | Untraceable changes to disbursement destinations | **Not audited** | Phase 1.J | Eng | 🔴 → Phase 1.J |
| Document access logging | Untraceable access to sensitive documents | **Not implemented** — `canAccessDocument()` authorizes but never logs | Phase 1.J | Eng | 🔴 → Phase 1.J |
