# Runbook: Credential Compromise

**Status: Documented procedure, not yet drilled.**

## Recognize the credential type first — response differs

| Credential | Where it lives | Rotation method |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env var; Supabase project settings | Regenerate in Supabase dashboard (Project Settings → API) → update Vercel env var → redeploy |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env var; public by design (ships to the browser) | Lower urgency than service-role — this key is meant to be public and relies on RLS, not secrecy. Rotate if RLS itself is suspected compromised, not just because this key is "known." |
| `ANTHROPIC_API_KEY` | Vercel env var; Anthropic console | Regenerate in Anthropic console → update Vercel env var → redeploy. Revoke the old key explicitly, don't just stop using it. |
| `RESEND_API_KEY` | Vercel env var; Resend dashboard | Same pattern — regenerate, update, redeploy, revoke old |
| `CRON_SECRET` | Vercel env var; GitHub repo secret (`.github/workflows/cron-*.yml` use it) | Generate a new random value, update **both** Vercel and the GitHub repo secret, redeploy |
| `INTERNAL_SECRET` | Vercel env var | Generate new value, update Vercel, redeploy |
| Dispatch tokens (`erp_connections.dispatch_token_hash`) | Hashed in the database (`docs/enterprise-readiness/ASSESSMENT.md` P0-4) | **Per-org, not platform-wide.** Revoke via `UPDATE erp_connections SET dispatch_token_revoked_at = now() WHERE org_id = '<org>'`, or have the org re-run Connect in Settings → ERP Integration (issues a fresh token, old one still needs explicit revocation since a new connect doesn't auto-revoke — verify this behavior before relying on it, or revoke manually) |
| A user's Supabase Auth session/password | Supabase Auth | Force password reset (Supabase Auth admin API or dashboard); for a suspected session-token compromise, Supabase Auth session revocation via the admin API |
| GitHub personal access tokens / deploy keys | GitHub | Revoke in GitHub settings; audit what the token could access before assuming blast radius is limited |
| UPSTASH_REDIS_REST_TOKEN | Vercel env var; Upstash console (if configured) | Regenerate in Upstash console, update Vercel, redeploy. Low sensitivity (only gates rate-limit counters) but rotate anyway on general principle |

## General procedure

1. **Confirm it's actually compromised**, not just potentially exposed — e.g., a key committed to a private repo's history that was never actually accessed by anyone unauthorized is a different response than one confirmed used from an unrecognized IP. Don't skip rotation just because you're unsure, but do prioritize based on confirmed vs. suspected.
2. **Rotate immediately** per the table above — don't wait to understand the full blast radius first. A rotated-but-not-yet-fully-investigated credential is safer than an unrotated one.
3. **Redeploy** so the new value takes effect (Vercel env var changes require a new deployment to apply to already-running instances — confirm this is still true for the current Vercel setup, as platform behavior can change).
4. **Audit usage of the old credential** before rotation, if logs allow — Supabase logs (retention: UNVERIFIED, see `docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md`), Vercel function logs, or `audit_events`/`agent_actions` if the compromised credential was used to make application-level calls that got logged there.
5. **Determine how it leaked.** Common paths for this codebase specifically: a real-looking value accidentally left in an `.env.*.example` file (this happened once — `docs/enterprise-readiness/ASSESSMENT.md` P0-2 — and is exactly why those files are now git-tracked and reviewable rather than gitignored-and-invisible), a value pasted into a chat/ticket/doc, a value logged somewhere it shouldn't have been (check whether `apps/web/lib/logger.ts`'s redaction should have caught it and didn't — that's a bug in the redaction pattern list to fix).
6. **Follow `docs/security/INCIDENT_RESPONSE.md`** for severity classification and post-incident review.

## Specific to this codebase: things that look like secrets and need checking

- `apps/web/.env.production.example` — must only ever contain placeholders. If a real-looking value appears here again, treat it as a live incident even before confirming it's real (per the P0-2 precedent).
- `erp_connections` table — dispatch tokens are hashed since this engagement's fix, but the legacy plaintext `dispatch_token` column still exists for rows that haven't rotated (`docs/enterprise-readiness/ROADMAP.md` 1.G) — a database-level compromise before that column is purged still exposes those older values.
- Local `.env.local` files on any contributor's machine — never committed (verified via `.gitignore`), but a compromised laptop is a real exposure path outside this repo's control.
