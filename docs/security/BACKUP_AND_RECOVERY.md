# Backup and Recovery

**Status: Mostly unverified.** Supabase provides backup/PITR capability as a platform feature, but this engagement had no dashboard access to confirm what's actually configured on Strike's project. Everything below marked UNVERIFIED must be checked and this document updated with real findings before it's treated as accurate — see `docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md` for the same items tracked as checklist rows.

## What Supabase provides

- Automated daily backups (plan-dependent — **UNVERIFIED** which plan Strike is on)
- Point-in-time recovery, PITR (typically a paid-plan feature with a configurable retention window — **UNVERIFIED** whether enabled and what window)
- Backups are stored and managed by Supabase; Strike does not currently run its own independent backup/export process (**UNVERIFIED** — confirm nothing else exists, e.g. an ad hoc `pg_dump` cron job)

## What Strike is responsible for

1. **Confirming the above is actually configured** — plan tier, PITR window, backup retention period. Owner: *[Assign — whoever holds Supabase project admin access]*.
2. **Testing a restore.** An untested backup is not a real control. See `docs/runbooks/DATABASE_RESTORE_TEST.md` for the procedure to actually exercise this — as of this document, **it has not been run**.
3. **Application-level data** that lives outside Supabase Postgres:
   - Supabase Storage buckets (`kyb-documents`, `deal-documents`, `internal-documents`, listing images, etc.) — covered by Supabase's own storage durability, but restore/versioning behavior for these buckets specifically is **UNVERIFIED**.
   - Nothing is currently stored outside Supabase (no separate S3 bucket, no local filesystem persistence) — confirmed by code review (all `adminClient.storage.from(...)` calls target Supabase Storage).
4. **Migration/seed reproducibility** — distinct from backup/restore, but related: this engagement verified that `supabase/migrations/*.sql` + the corrected `supabase/seed.sql` can build a working schema from scratch (see `docs/enterprise-readiness/ASSESSMENT.md` P1-2). That's a *fresh environment* guarantee, not a *restore a specific point in time* guarantee — don't conflate the two.

## Recovery time / recovery point objectives

**Not yet defined.** Before pilot launch, decide and document:
- RTO (how long can the app be down during a restore before it's unacceptable?)
- RPO (how much data loss, in time, is acceptable — i.e., how far back could PITR need to reach?)

These numbers should come from a business conversation (what would a bank/anchor/supplier customer actually tolerate?), not be invented here.

## Backup scope — what's NOT covered by a database restore

- Environment variables / secrets (these live in Vercel's env var UI, not the database — losing them is a separate risk, mitigated by `apps/web/.env.production.example` documenting what's required, though not the values themselves)
- GitHub repository state (covered by GitHub's own durability, plus the fact that the full history exists on every contributor's local clone)
- Third-party service state (Anthropic usage history, Resend send logs, etc. — not Strike's to back up)

## Next steps (tracked in `docs/enterprise-readiness/ROADMAP.md`)

1. Confirm actual Supabase plan/PITR/backup configuration (dashboard check, not code).
2. Run the restore drill in `docs/runbooks/DATABASE_RESTORE_TEST.md` against a non-production target.
3. Define RTO/RPO with the business.
4. Revisit this document with real, evidenced answers in place of every UNVERIFIED marker above.
