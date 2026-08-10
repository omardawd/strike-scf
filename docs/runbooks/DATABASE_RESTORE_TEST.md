# Runbook: Database Restore Test

**Status: Procedure only — has NOT been executed.** This is the single most important gap flagged in `docs/security/BACKUP_AND_RECOVERY.md`: an untested backup is not a real control. Run this before claiming backup/recovery as an operating capability to a customer.

## Goal

Prove that a Supabase backup (or PITR snapshot) can actually be restored to a working database, and measure how long it takes — informs the RTO conversation in `docs/security/BACKUP_AND_RECOVERY.md`.

## Do NOT do this against the production project

This must run against a **separate Supabase project** (a fresh project, or a Supabase branch if using that feature — `mcp__supabase__create_branch` is available as a tool for exactly this) — never restore over or otherwise touch the live production database as part of a test.

## Procedure

1. **Identify a restore point.** Via the Supabase dashboard (Database → Backups), pick either a daily backup or a PITR timestamp (if PITR is enabled — confirm first, per `docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md`).
2. **Restore to a new/branch project**, not production. Supabase's dashboard restore flow typically handles this, or use `mcp__supabase__create_branch` + `mcp__supabase__rebase_branch`/restore tooling if testing via a branch.
3. **Time the process** from "restore initiated" to "database queryable" — this is real RTO data, not a guess.
4. **Verify data integrity** against a known point:
   - Row counts on a few key tables (`organizations`, `transactions`, `deals`) compared to what's expected as of the restore point.
   - Spot-check that RLS policies are intact (run one of the queries from the fresh-environment validation this engagement built — see `scripts/db-validate.sh`, adapted to check an existing restored DB rather than build one from scratch).
   - Confirm `pg_cron` jobs (if any were scheduled — `apps/web/CLAUDE.md` documents an `agent-negotiation-tick` job) are NOT automatically active on the restored copy, to avoid the restored instance taking real actions.
5. **Verify the application can actually connect** — point a local/staging deployment's env vars at the restored project's connection details and confirm basic read functionality (this is the real test; a database that "restores" but that the app can't actually use isn't a working recovery).
6. **Tear down** the test project/branch when done — don't leave a copy of production-shaped data sitting in an unmonitored project indefinitely.
7. **Document the result**: actual RTO achieved, any issues encountered, and update `docs/security/BACKUP_AND_RECOVERY.md`'s RTO/RPO section with real numbers instead of placeholders.

## Cadence

**Not yet established.** Recommended: at minimum once before pilot launch, then on a recurring basis (quarterly is a common baseline for this kind of drill) once there's a real customer depending on the guarantee. Owner: *[Assign]*.

## What this drill does NOT cover

- Application-level data outside Postgres (Supabase Storage buckets) — those have their own durability model; this runbook is Postgres-specific. If Storage durability needs the same drill treatment, write a companion runbook rather than silently assuming Postgres coverage implies Storage coverage.
- Point-in-time recovery to a moment *during* an active incident (this drill tests the mechanism in isolation, not under real incident pressure) — the first real incident will be the actual test of that, which is exactly why running this drill in calm conditions first matters.
