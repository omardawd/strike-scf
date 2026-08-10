# Runbook: Production Rollback

**Status: Documented procedure, not yet drilled.** Vercel provides the underlying rollback capability; this runbook has not been exercised end-to-end against this specific project.

## When to use this

- A deploy to `main` introduces a regression (functional bug, broken build, performance issue) discovered after it's live.
- A deploy is found to contain a security issue that needs immediate reversal while a proper fix is prepared.

## Before you start

- Confirm the current production deployment is actually the problem (not, e.g., a Supabase-side issue, an expired third-party API key, or a DNS problem) — rolling back doesn't fix those and wastes the response window.
- Note the current deployment's commit SHA/timestamp before rolling back, for the post-incident write-up.

## Procedure (Vercel Git integration)

Strike SCF deploys via Vercel's Git integration — pushes to `main` trigger a production deploy automatically (this repo's own `.github/workflows/ci.yml` explicitly does **not** deploy; that's Vercel's job, separate from CI). Two rollback paths:

### Option A — Vercel dashboard instant rollback (fastest)

1. Open the Vercel project dashboard → Deployments.
2. Find the last known-good deployment (before the problematic one).
3. Use Vercel's "Promote to Production" / rollback action on that deployment.
4. This repoints production traffic to the previous build **without a new git commit** — the fastest option, but means `main` and what's actually deployed are now out of sync until a proper fix is pushed.
5. **Immediately after**: communicate the rollback (see `docs/security/INCIDENT_RESPONSE.md`) and open a tracking issue so the git-vs-deployed drift doesn't get forgotten.

### Option B — git revert (keeps history honest)

1. `git revert <bad-commit-sha>` (or revert the merge commit if it was a squashed PR) on `main`.
2. Push — this triggers a new Vercel deploy from the reverted state.
3. Slower (waits for a full build) but keeps `main` and production in sync, and preserves a clean audit trail of what happened in git history — generally preferred unless Option A's speed is genuinely needed.

**Never force-push to `main` to "undo" a bad commit** — that rewrites history other people may have already pulled, and this repo's own safety rules (and general git hygiene) prohibit it without explicit, scoped authorization.

## Database considerations

**Rolling back the application code does not roll back the database.** If the bad deploy included a migration that already ran (`supabase/migrations/*.sql` applied to production), reverting the app code does not undo the schema change. Before rolling back a deploy that included a migration:
1. Assess whether the migration itself needs a corresponding down-migration (forward-only migrations are the house style — `apps/web/CLAUDE.md` — so "rolling back" a bad migration usually means writing a new forward migration that fixes it, not reverting the old one).
2. If application code depends on the new schema and you roll back to code that doesn't expect it, confirm compatibility first — this is exactly the kind of interaction the migration's own PR should have documented.

## Verification after rollback

1. Hit `/api/health` and `/api/ready` on the production URL — both should return 200.
2. Spot-check the specific feature that regressed.
3. Confirm no new errors in Vercel function logs / error-tracking (once `ERROR_TRACKING_DSN` is configured — see `docs/enterprise-readiness/ASSESSMENT.md`'s observability section) for the rolled-back deployment.

## After the rollback

Follow `docs/security/INCIDENT_RESPONSE.md`'s post-incident review step. Do not let "we rolled back" substitute for "we understood why it broke."
