# Strike SCF — Manual Infrastructure Checklist

These items **cannot be verified from code** and were not checked as part of this engagement (no Vercel/Supabase/GitHub dashboard access was available). Nothing here should be read as "confirmed configured" — every row is a to-do for whoever holds dashboard access, with a status of **UNVERIFIED** until someone checks it and records evidence (a screenshot, a settings export, or a dated note of who confirmed it).

Do not mark any row "done" without evidence. This file is meant to be updated in place as items are actually checked.

---

## Vercel

| Item | Why it matters | Status | Evidence |
|---|---|---|---|
| Confirm current plan (Hobby vs Pro vs Enterprise) | Determines cron limits, preview protection availability, log retention, team size limits | UNVERIFIED — prior session evidence suggests Hobby (a real deployment failure hit the 2-cron/day cap), but re-verify directly in the dashboard before relying on it | — |
| Team members have MFA enforced | Account takeover of a deploy-capable account = full compromise | UNVERIFIED | — |
| Production deploys require approval (if plan supports it) | Unreviewed deploys reaching real users | UNVERIFIED | — |
| Preview deployment protection (password/SSO-gated previews) | Preview URLs often leak via search engines/link sharing and can run against real or near-real data | UNVERIFIED | — |
| WAF / bot protection enabled (if plan supports it) | Reduces automated abuse at the edge, ahead of application rate limiting | UNVERIFIED | — |
| Log drains configured to a durable destination | Vercel's own log retention window is short; incident investigation needs longer retention | UNVERIFIED | — |
| Spend/usage alerts configured | Runaway AI-endpoint abuse (see P0-5, unthrottled AI routes) could generate a large surprise bill before rate limiting ships | UNVERIFIED — **recommended to set up immediately, independent of the code fix timeline** | — |
| Env vars for production are set directly in Vercel, not sourced from a committed file | Confirms `.env.production.example` is genuinely just a template | UNVERIFIED (reasonable to assume true given `.gitignore` coverage, but not confirmed) | — |
| Rollback procedure tested at least once | `docs/runbooks/PRODUCTION_ROLLBACK.md` should reference a real, tested capability | UNVERIFIED | — |
| Stray/duplicate project link for this repo cleaned up | Prior session noted an unresolved stray Vercel project link for `my-turborepo` | UNVERIFIED — carry over from prior session, re-check | — |

## Supabase

| Item | Why it matters | Status | Evidence |
|---|---|---|---|
| Confirm current plan | Determines PITR availability, backup retention window, log retention | UNVERIFIED | — |
| Team members have MFA enforced | Same rationale as Vercel — a compromised Supabase account has service-role-equivalent reach | UNVERIFIED | — |
| Point-in-time recovery (PITR) enabled | Recovery granularity after data corruption/bad migration | UNVERIFIED | — |
| Backup retention window documented | Determines how far back recovery is possible | UNVERIFIED | — |
| A restore has actually been tested (not just "backups exist") | Untested backups are not a real control | UNVERIFIED — `docs/runbooks/DATABASE_RESTORE_TEST.md` (Phase 1.K) documents the *procedure*; the *drill* itself is Phase 2 | — |
| SSL enforcement on database connections | Prevents plaintext DB traffic interception | UNVERIFIED | — |
| Network restrictions (IP allowlist) on the database, if applicable | Reduces exposure of the direct Postgres connection | UNVERIFIED | — |
| Supabase Security Advisor findings reviewed | Supabase surfaces its own automated security findings (RLS gaps, function search_path issues, etc.) — likely to independently confirm some findings in ASSESSMENT.md §4 | UNVERIFIED — **recommended as a fast, high-value first check**, since it may surface the 11-zero-policy-table gap (P1-1) directly in the dashboard UI | — |
| Log retention window | Incident investigation capability | UNVERIFIED | — |
| `pg_cron` job `agent-negotiation-tick` (jobid 1) still running on schedule | CLAUDE.md documents this as the actually-reliable tick mechanism (GitHub Actions cron is unreliable for sub-hourly jobs); verify via `select * from cron.job_run_details where jobid=1 order by start_time desc limit 10;` | UNVERIFIED — not re-run in this engagement (no DB access) | — |
| `service_role` key rotation history / last rotated date | Long-lived service-role keys are a high-value target | UNVERIFIED | — |

## Git hosting (GitHub)

| Item | Why it matters | Status | Evidence |
|---|---|---|---|
| Branch protection on `main` | Prevents direct unreviewed pushes | UNVERIFIED | — |
| Required reviewers on PRs | Enforces change review | UNVERIFIED | — |
| Required status checks (once CI exists from Phase 1.B) | Prevents merging on red CI | UNVERIFIED — depends on Phase 1.B landing first | — |
| GitHub secret scanning enabled | Catches committed credentials the repo's own tooling might miss | UNVERIFIED | — |
| GitHub push protection enabled | Blocks a commit containing a detected secret *before* it lands | UNVERIFIED | — |
| Dependabot alerts enabled at the org/repo level (distinct from the Phase 1.B workflow-based check) | Platform-level baseline even if the CI-based scan has a gap | UNVERIFIED | — |
| Repo visibility (private, confirmed) | Public exposure of a fintech codebase with real architectural detail would itself be a risk | UNVERIFIED — almost certainly private given the nature of the project, but should be explicitly confirmed, not assumed | — |

## DNS / email / domain security

| Item | Why it matters | Status | Evidence |
|---|---|---|---|
| SPF record for the Resend-sending domain | Email deliverability + anti-spoofing | UNVERIFIED | — |
| DKIM configured for Resend | Email authenticity | UNVERIFIED | — |
| DMARC policy set | Anti-phishing protection for the domain | UNVERIFIED | — |
| Domain registrar account secured (MFA, transfer lock) | Domain hijack = total platform compromise (auth redirects, email, everything) | UNVERIFIED | — |

## Vendor / subprocessor management

| Item | Why it matters | Status | Evidence |
|---|---|---|---|
| DPA on file with Supabase | Legal data-processing obligations | UNVERIFIED | — |
| DPA on file with Vercel | Same | UNVERIFIED | — |
| DPA on file with Anthropic | Same (AI processes real business/financial data) | UNVERIFIED | — |
| DPA on file with Resend | Same (email may contain business-sensitive content) | UNVERIFIED | — |
| DPA on file with Tavily (web search) | Lower sensitivity (outbound search queries only) but still worth confirming | UNVERIFIED | — |
| Subprocessor list published/available (see `docs/security/SUBPROCESSORS.md`, Phase 1.K) | Customer security questionnaires ask for this directly | Doc will exist after Phase 1.K; DPA collection itself is a legal/ops task, not engineering | — |

## Production secret rotation (tracking only — no values recorded here)

| Credential | Rotation needed? | Reason | Status |
|---|---|---|---|
| Resend API key | **Yes** | A real-looking key was found in `apps/web/.env.production.example` (P0-2). Even though it was never in git history, it existed in a template file that could have been shared, copy-pasted, or committed by any developer. Treat as potentially exposed. | Pending manual rotation in the Resend dashboard — cannot be done from this repo/engagement |
| `/api/ai/dispatch` tokens (`erp_connections.dispatch_token`) | Recommended, not urgent | Currently plaintext at rest with no expiry (P0-4). Once Phase 1.G ships hashed-token storage, existing plaintext tokens should be rotated to the new format rather than migrated as-is, since their plaintext values have already existed in the DB and UI. | Scheduled for Phase 1.G |
| Supabase `service_role` key | Routine hygiene, not evidence of compromise | No evidence of exposure found in this engagement; rotate per normal key-hygiene cadence if it's been long-lived | Owner to decide cadence |
| `CRON_SECRET` | Routine hygiene | No evidence of exposure; confirmed properly gated everywhere it's used | Owner to decide cadence |
| `ANTHROPIC_API_KEY` | Routine hygiene | No evidence of exposure | Owner to decide cadence |

---

## How to use this file

1. Whoever has dashboard access to each system should go row by row, record the actual finding, and change UNVERIFIED to a real status (Configured / Not configured / Partially configured) with evidence.
2. Anything found "Not configured" that maps to a P0/P1 item in `ASSESSMENT.md` should be escalated the same way a code finding would be — this file is not a lower tier of severity, it's a different *verification method*.
3. Re-run this checklist before any customer security review, not just once at the start of this engagement — dashboard settings drift independently of code.
