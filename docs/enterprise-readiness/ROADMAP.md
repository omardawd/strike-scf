# Strike SCF — Enterprise Readiness Roadmap

Companion to [`ASSESSMENT.md`](./ASSESSMENT.md). Phases are sequential; items within a phase can run in parallel unless a dependency is noted. Effort estimates assume one senior full-stack engineer familiar with this codebase; they are planning inputs, not commitments.

---

## Phase 0 — Immediate containment (hours, not days)

Goal: remove the handful of things that are actively unsafe *today*, with minimal code change and zero behavior change for real users.

| # | Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|---|
| 0.1 | Redact the real-looking Resend key in `.env.production.example`; replace with placeholder | — | File contains no credential-shaped value; grep for `re_` prefix returns nothing outside comments | 15 min |
| 0.2 | Add gitignore exception so `.env.production.example` is actually tracked in git | 0.1 | `git ls-files` includes the file | 15 min |
| 0.3 | Fix `/api/risk/score` cross-tenant write (add `org.bank_id !== me.bank_id` check for bank callers) | — | Manual test: bank A cannot POST a score for bank B's org (403) | 30 min |
| 0.4 | Add `DEMO_ROUTES_ENABLED` env guard to all `/api/demo/*` routes, default off in production | — | With the flag unset/false, every demo route returns 404; with it true, existing behavior unchanged | 1 hr |
| 0.5 | Document the (already-fixed) `rooms_private` RLS history in the assessment (done) and confirm no other policy has the same copy-paste bug | — | Grep of full migration set for `X.id = X.id`-shaped self joins returns only the known, superseded line | 30 min |

**Total: ~3 hours.** No schema migration, no route contract changes, no behavior change for any real (non-demo, non-bank-admin-abusing) user.

---

## Phase 1 — Audit-ready engineering foundation

Goal: the things a customer's security team will ask for directly. This is the bulk of the engagement.

### 1.A Secrets & production isolation
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Production env-validation module (fails fast/safe if required vars missing) | — | Boot with a missing required var → clear startup error, not a runtime 500 deep in a request | 2-3 hrs |
| Document all credentials requiring rotation (Resend key; review dispatch tokens once hashed in 1.G) | 0.1 | A markdown list exists with rotation status per credential, no values in it | 1 hr |

### 1.B CI/CD
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| `ci.yml`: install → migration/schema validation → typecheck → lint (against ratcheted baseline) → build, on PR + push to main | 1.C (for test step), lint baseline decision | Green on a clean PR; fails on a newly introduced type/lint error | 4-6 hrs |
| Dependency scanning (Dependabot or `npm audit` gate) + secret scanning (gitleaks) + basic SAST (CodeQL) | — | Workflow runs on PR, minimum token permissions, no production secrets referenced | 2-3 hrs |
| Concurrency cancellation for superseded PR runs | — | Pushing twice to the same PR cancels the first run | 15 min |

### 1.C Testing foundation
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Pick + wire up test tooling (Vitest for unit/API integration, Playwright for E2E) compatible with Next.js 16 | — | `npm test` runs locally and in CI against a local/ephemeral Supabase, not production | 3-4 hrs |
| Local/ephemeral Supabase test target (fix `config.toml` absence, or a documented alternative like a dedicated test project) | 1.E (seed fix) | Tests never connect to the real project URL — enforced by an assertion in test setup, not just convention | 2-4 hrs |
| Authorization-matrix test suite — the 12 categories in the engagement brief (unauthenticated access, inactive users, role enforcement, tenant isolation for bank/org/deal/room/document, admin actions, invitation tokens, cron-secret validation, AI tool authorization, external dispatch, demo-route isolation) | 1.D (helpers), 1.C tooling | Every category has at least one passing test proving tenant A cannot touch tenant B's data; risk-score fix (0.3) has a regression test | 2-3 days (largest single item in Phase 1) |

### 1.D Authorization architecture
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Centralized `requireAuth()`/`requireRole()` + typed role/tenant context helper | — | New helper module exists, unit-tested in isolation | 1 day |
| Resource-level authorization helpers (org, bank, deal, listing, room, document, financing_request, transaction, program, network) | above | Each helper has a positive + negative test | 1-2 days |
| Migrate a representative high-risk sample (bank_accounts, documents/[id]/url, admin/*, risk/score, agents/tasks/*) to the new helpers | above | Behavior-identical per existing manual QA + new tests; NOT a mass rewrite of all 159 routes | 1-2 days |
| Inventory of routes still on manual auth (follow-up doc, not code) | above | A checked-in list exists, used to sequence future migration work outside this engagement | 2 hrs |

### 1.E Database & RLS
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Table/policy inventory doc (derived from the P1-1 findings) | — | Every table has a documented RLS status | done as part of ASSESSMENT.md; formalize in CONTROL_MATRIX |
| New forward-only migration adding policies to the 11 zero-policy tables | — | `supabase db reset` (once seed is fixed) leaves no table RLS-enabled-with-zero-policies, verified by a script | 1 day |
| Fix `seed.sql` enum drift (org status, risk_tier, financing_types, transaction status) | — | Fresh `supabase db reset` completes without error | 3-4 hrs |
| Prove fresh local environment reproducibility | above two | Documented, repeatable command sequence; CI runs it (ties into 1.B) | included above |
| DB-level tests for the fixed `rooms_private`-style policies and the new 11-table policies | 1.C | pgTAP or equivalent test proving cross-tenant SELECT/UPDATE denied | 1 day |

### 1.F Abuse prevention
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Replace in-memory rate limiter with Upstash Redis (or equivalent) behind a small provider abstraction with safe fallback | — | Enforced consistently across ≥2 serverless instances (test via concurrent requests) | 1 day |
| Apply limits to: auth/register, invitations (already has it), uploads, AI endpoints (chat/documents/upload/dispatch), external dispatch, document generation, search, reports | above | Each listed endpoint returns `429` + `Retry-After` once its limit is exceeded, keyed by authenticated user/org id (not client-supplied header) | 1 day |
| Request-body and upload-size limits at the framework level (not just per-route ad hoc) | — | A route with no explicit check still rejects oversized bodies | 3-4 hrs |

### 1.G External AI dispatch hardening
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Threat model doc for `/api/ai/dispatch` | — | Written doc: assets, actors, trust boundary, accepted risks | 2 hrs |
| Hash dispatch tokens at rest (prefix + digest lookup pattern), migration + route rewrite | 1.E migration pattern | Old plaintext tokens migrated or rotated; new tokens never stored/displayed after creation except once | 1 day |
| Add `expires_at`, `scopes`, revocation support | above | Expired/revoked token → 401; scope-restricted token can't invoke out-of-scope tools (tested) | 1 day |
| Rate limiting + replay/idempotency protection + request validation | 1.F | Duplicate request with same idempotency key doesn't double-execute | 4-6 hrs |
| Restrict CORS to configured origins where browser use is required | — | Wildcard removed unless a documented browser use case needs it | 2 hrs |
| Append-only audit events for every dispatch call | 1.J | Every dispatch invocation produces an `agent_actions`-style row, tool-scoped | 3-4 hrs |
| Tests proving a token can't operate outside its org/scopes | 1.C | Negative tests pass | included in 1.C matrix |

### 1.H Observability foundation
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Structured server logger with redaction (credentials, tokens, financial account data, document contents) | — | Logger module exists, redaction unit-tested against known-sensitive field names | 1 day |
| Request/correlation IDs propagated through API responses and logs | above | A single request's ID appears in all logs it generates | 4-6 hrs |
| `/api/health` + `/api/ready` (no secrets revealed) | — | Both return 200 with minimal, non-sensitive payload | 2 hrs |
| Disabled-by-default error-tracking abstraction (e.g. Sentry) | — | With no config, zero external calls made (verified by test); with config, errors report | 4 hrs |
| Documented recommended alerts + log-retention settings | above | Doc exists, references actual Vercel/Supabase capabilities from the manual checklist | 2 hrs |

### 1.I Security hardening
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| CSP: document a safe path to remove `unsafe-eval` and reduce `unsafe-inline`; execute the parts that are safe now | — | Doc + at least a first incremental tightening if verifiably safe; no behavior regression | 4-6 hrs (doc) + variable (execution, may extend into Phase 2) |
| Shared upload-validation helper (size, MIME allowlist, filename sanitization) applied to the 3 unsanitized routes + standardized elsewhere | — | All 12 upload routes use the shared helper | 1 day |
| Malware-scanning integration point (interface + no-op default, real provider deferred) | above | A clear extension point exists; documented as Phase 2/3 to actually wire a scanner | 3-4 hrs |
| CORS/SSRF/redirect/signed-URL/caching/error-response review | — | Findings folded into CONTROL_MATRIX; any quick fixes applied, larger ones scheduled | 1 day review |
| `SECURITY.md` + disclosure documentation | — | Exists, honest, no false claims | 2 hrs |

### 1.J Audit trails & AI governance
| Item | Depends on | Acceptance criteria | Effort |
|---|---|---|---|
| Canonical append-only audit-event schema (actor, tenant, action, target, timestamp, request ID, source, outcome, safe before/after) | 1.E migration pattern | Schema migration lands, no document bodies/full bank details/secrets stored in it | 1 day |
| Wire audit writes into: role changes, KYB decisions (including the currently-uncovered org-initiated transitions), credit overrides, bank-detail changes, contracts, offers, disbursements, repayments, document access, external dispatch, AI tool actions | above | Each category has at least one write path verified by test | 2-3 days |
| Ensure audit writes cannot silently disappear (currently: fail-soft try/catch swallows errors per CLAUDE.md's own note about migration 032) | above | A failed audit write is itself logged/alerted, not silently dropped | 4-6 hrs |
| Document model/version, tool use, input provenance, output, human decision, override reason for AI actions | 1.G, 1.J schema | `agent_actions` rows for AI tool calls carry this metadata | included above |

### 1.K Operational documentation
All items in the engagement brief's list (`SECURITY.md`, `docs/security/*.md` ×7, `docs/runbooks/*.md` ×3). These are largely independent of code work and can run in parallel with 1.A–1.J. Each must be an honest operating document with named owner placeholders and evidence requirements, not a claim that controls are live. **Effort: 1-2 days total for a first honest draft of all 12 documents; they will need real owners assigned by Strike, not by this engagement.**

---

## Phase 2 — Pilot readiness

Triggered once Phase 1 is merged and a real pilot customer is being onboarded. Not built in this engagement; listed for sequencing.

- Route the remaining manually-authorized API routes through the Phase 1 authorization helpers (using the Phase 1 inventory as the punch list), in small batches with tests per batch.
- Real malware-scanning integration (ClamAV or a managed scanning API) behind the Phase 1 extension point.
- MFA (Supabase Auth TOTP) enablement for bank/admin roles at minimum.
- CSP tightening execution (remove `unsafe-eval`; move toward nonce-based inline scripts).
- Real distributed rate-limit tuning based on actual pilot traffic patterns.
- First tested backup/restore drill (`docs/runbooks/DATABASE_RESTORE_TEST.md` executed for real, not just documented).
- Vendor DPA collection for all subprocessors (Supabase, Vercel, Anthropic, Resend, Tavily) — legal/ops task, not engineering, but blocks a real audit.

## Phase 3 — SOC 2 operational maturity

Not started in this engagement — listed to show the destination the roadmap is heading toward.

- Formal change-management process (this roadmap's Phase 1 CI is the technical prerequisite; the *process* — required reviews, deploy approvals — is largely a GitHub branch-protection + Vercel settings exercise, tracked in the manual checklist).
- Continuous vulnerability management cadence (scheduled dependency/SAST scans already exist from Phase 1; SOC 2 needs a documented remediation SLA on top).
- Incident response drills against `docs/security/INCIDENT_RESPONSE.md`.
- Access reviews (quarterly review of who has bank/org/admin roles — a process, not code).
- Formal SOC 2 Type I readiness assessment with an external auditor once the above is operating, not just documented.

---

## Sequencing notes

- **1.D (authz helpers) should land before 1.C's authorization-matrix tests are written against migrated routes**, but the *unmigrated* routes' tests can be written first against current behavior — don't block all testing on the helper migration.
- **1.E's seed fix blocks 1.C's local test environment** — do this early, it's small (3-4 hrs) and unblocks the largest item in the phase.
- **1.G (AI dispatch hardening) is the single largest Phase 1 track** — consider running it partially in parallel with 1.F (rate limiting) since they share almost no code surface.
- **1.K (docs) has no code dependencies** — assign to run fully in parallel with everything else.
