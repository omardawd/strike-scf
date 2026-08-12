# Secure Development Practices

## Source of truth

`apps/web/CLAUDE.md` is the single authoritative context file for how this codebase works — API route patterns, schema, "what not to do" list. Read it before making changes. This document covers *security-specific* practices layered on top of it.

## The API route pattern (security-relevant parts)

Every route should follow (from `apps/web/CLAUDE.md`):
1. `getUser()` (anon client) — never `getSession()` (deprecated, less secure).
2. Service-role admin client to look up the caller's `role`/`org_id`/`bank_id` — **always add a manual `.eq()` scope filter** when using the admin client; it bypasses RLS.
3. Explicit role gate.
4. Scoped query — filter to the caller's own tenant.

New code should prefer the centralized helpers in `apps/web/lib/auth/` (`requireSession()`, `requireRole()`, `canBankAccessOrganization()`, etc.) over hand-rolling this pattern, though as of this writing most existing routes still hand-roll it correctly — see `docs/enterprise-readiness/ROADMAP.md` 1.D for migration status. **When touching an existing route for an unrelated reason, consider migrating it to the shared helpers in the same PR if it's low-risk to do so** — but don't let that turn a small fix into a large refactor.

## Column-name schema drift (a real bug class in this codebase)

This engagement found and fixed a case where code (and `apps/web/CLAUDE.md`'s own schema docs) assumed a column (`organizations.bank_id`) that didn't exist in the live schema — the real column was `primary_bank_id` (`docs/enterprise-readiness/ASSESSMENT.md` P0-6). This is *not* caught by TypeScript (Supabase client calls aren't statically typed against the live schema unless generated types are kept in sync and actually used) or by lint. **Before trusting a column name from memory or from CLAUDE.md, especially for a security-relevant check, verify it against the actual migrations in `supabase/migrations/` or query the live schema directly.** The `mcp__supabase__execute_sql` tool (or the Supabase dashboard's SQL editor) is the fastest way to check.

## Never do these (security-specific; see `apps/web/CLAUDE.md` for the full non-security list too)

- Use `createClient()` (anon) for anything other than `getUser()`.
- Use the admin/service-role client without a manual `.eq()` tenant-scope filter.
- Trust a client-supplied identifier (header, body field) as a rate-limit key or as proof of tenant identity — always derive from the authenticated session or a server-validated token.
- Log or store full bank account numbers, routing numbers, SSN/EIN, passwords, tokens, or raw document contents — `apps/web/lib/logger.ts`'s `redact()` catches this for structured logs; `apps/web/lib/audit/log.ts` callers are responsible for the same discipline manually (the audit table has no automatic redaction).
- Weaken CSP, RLS policies, or lint rules to make something pass — fix the underlying issue instead (this is also a non-negotiable rule for anyone, human or AI, working on this repo per the original enterprise-readiness engagement brief).
- Commit a real-looking credential to any file, including `.example`/`.template` files — see the incident that motivated this: `docs/enterprise-readiness/ASSESSMENT.md` P0-2.

## CI gates (what actually runs before merge)

`.github/workflows/ci.yml`: install, typecheck, lint (ratcheting warning baseline, `docs/enterprise-readiness/ASSESSMENT.md` P1-8), unit tests, production build, DB schema/seed validation. `.github/workflows/codeql.yml`: static analysis. Dependabot: weekly dependency updates. See `docs/enterprise-readiness/ROADMAP.md` 1.B for what's intentionally not yet included (e.g., CI does not deploy anything).

## Code review expectations

Not formally documented before this engagement. Recommended minimum once branch protection is confirmed/configured (`docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md`): at least one review before merging to `main`, required status checks (the CI workflow above) passing. Security-sensitive changes (auth, RLS, secrets handling, external dispatch) should get a second look specifically for tenant-isolation correctness — the P0-1/P0-6 bugs found in this engagement are exactly the class of thing a second reviewer catches.

## Dependency hygiene

Dependabot (`​.github/dependabot.yml`) opens weekly update PRs, grouped by minor/patch to reduce noise. `npm audit` runs in CI as a non-blocking check today (first run — needs a human triage pass before it becomes a hard gate, per `.github/workflows/ci.yml`'s own comment). See `docs/security/VULNERABILITY_MANAGEMENT.md` for the fuller policy.
