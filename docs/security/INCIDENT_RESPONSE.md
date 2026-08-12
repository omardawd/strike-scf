# Incident Response Plan

**Status: Draft — not yet drilled.** This is the process we intend to follow. It has not been exercised end-to-end (see `docs/runbooks/` for the specific drills that would validate parts of it). Owners below are placeholders — assign real names before relying on this during an actual incident.

## What counts as a security incident

Any of the following:
- Confirmed or suspected unauthorized access to customer/org data (KYB documents, financial data, bank account details, contracts)
- A leaked or compromised credential (API key, service-role key, dispatch token, database password) — see `docs/runbooks/CREDENTIAL_COMPROMISE.md` for the specific response to this category
- Evidence of data exfiltration
- A vulnerability report (via `SECURITY.md`) assessed as exploitable in the current deployment
- Unexpected/unauthorized changes to production infrastructure, code, or data
- A finding from automated scanning (CodeQL, Dependabot, TruffleHog in CI) assessed as actively exploitable, not just theoretically present

## Roles

| Role | Responsibility | Owner (placeholder) |
|---|---|---|
| Incident Commander | Owns the response, makes the call on severity/containment actions, communicates status | *[Assign — typically Eng Lead or Security Lead]* |
| Technical Lead | Investigates root cause, implements containment/fix | *[Assign]* |
| Communications Lead | Drafts customer/stakeholder communications if needed | *[Assign — likely needed once there are real customers; not urgent pre-launch]* |

For a team this size today, one person may hold multiple roles — the point of naming them is so it's decided in advance, not during the incident.

## Severity levels

| Level | Definition | Example | Target initial response |
|---|---|---|---|
| SEV1 | Active data breach or exposure of customer data; production down | Leaked service-role key with evidence of use; KYB documents publicly accessible | Immediate — drop other work |
| SEV2 | Confirmed vulnerability with plausible exploit path, not yet evidence of exploitation | The P0 findings in `docs/enterprise-readiness/ASSESSMENT.md` before they were fixed | Same business day |
| SEV3 | Lower-severity finding, no immediate exploit path | A P2/P3 finding | Next sprint |

*(These response-time targets are proposed, not yet tested against real incident volume — revisit once there's operating history.)*

## Response steps

1. **Detect / receive report.** Via `security@strikescf.com` (see `SECURITY.md`), automated scanning (CI), or internal discovery.
2. **Triage.** Incident Commander assigns a severity level within [target: 1 business day for SEV2/3, immediately for SEV1 — unverified target].
3. **Contain.** Depends on the finding — may mean rotating a credential (`docs/runbooks/CREDENTIAL_COMPROMISE.md`), disabling a feature flag, revoking a dispatch token (`app/api/erp/connect` DELETE, or a direct DB update setting `dispatch_token_revoked_at`), or rolling back a deploy (`docs/runbooks/PRODUCTION_ROLLBACK.md`).
4. **Investigate.** Determine root cause and blast radius. Today's log/audit surface for this: `audit_events` table (migration `00000000000045`) for role/document/bank-account events, `agent_actions` for AI tool calls, `transaction_events`/`deal_events` for business lifecycle, Vercel function logs (retention: **unverified**, see `docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md`), and Supabase logs (retention: **unverified**).
5. **Remediate.** Fix the root cause, not just the symptom. If a code change, follow normal PR review — do not skip CI even under time pressure unless the SEV1 severity genuinely requires it, and if so, document why afterward.
6. **Notify.** Once there are real customers: notify affected parties per contractual/legal obligations. *(No such obligations exist yet — no production customers. Revisit before pilot launch.)*
7. **Post-incident review.** Blameless write-up: what happened, why, what changed as a result. Feed relevant findings back into `docs/enterprise-readiness/ASSESSMENT.md`'s P0–P3 tracking.

## Escalation contacts

*(Placeholders — fill in before this document is relied upon)*
- Supabase support: *[account-specific support channel]*
- Vercel support: *[account-specific support channel]*
- Legal counsel (for breach notification obligations once applicable): *[Assign]*

## What this plan does not yet cover

- Legal/regulatory breach-notification timelines (no customers yet, so no applicable obligations — but this must be revisited before pilot launch, since SCF/KYB data likely triggers state/federal notification requirements once real customer data is involved)
- A tested communication template for customer-facing incident notices
- An on-call rotation (team is small enough today that this hasn't been needed; revisit as headcount grows)
