# AI Governance

Strike SCF uses Claude (Anthropic) for KYB/risk scoring, document generation, chat assistance, and — the most consequential surface — autonomous marketplace negotiation via an org-level AI agent. This document describes what's actually built (verified against the code, not aspirational) and where the governance gaps are.

## Core principle: humans approve consequential decisions

This is a real, load-bearing architectural control, not a policy statement layered on top. The "two-gate" negotiation design (`apps/web/CLAUDE.md`, "Autonomous Agent Manager & Two-Gate Negotiation"):

- **GATE 1**: a human approves the negotiation *plan* once (price floor/ceiling, max rounds, deadline).
- Autonomous rounds run within those guardrails — server-side validated (`checkPriceGuardrail`), not merely prompted; an out-of-bounds AI decision escalates back to a human rather than executing.
- **GATE 2**: a second, explicit human approval is required before any offer is actually accepted. `accept_marketplace_offer` is **never given a schema in any tool set** — the only code path that can execute it is a human clicking approve on a `negotiation_ready_to_finalize` task. Confirmed by code inspection, not just by the system prompt telling the model not to.

This means: **the AI can negotiate autonomously within bounds a human set, but cannot itself create a binding deal.** Anyone auditing this system should verify this claim directly against `lib/ai/agent-tick.ts` and `lib/ai/tools/definitions.ts` (grep for `accept_marketplace_offer`) rather than trusting this document alone — that's good practice for any "trust me" claim in a governance doc.

## What data reaches the model

- KYB/financial data, deal terms, document contents (via the AI document-generation and extraction features), chat messages, and ERP-synced financial data (`erp_sync_data`) can all be included in prompts sent to Anthropic's API, depending on the feature.
- Anthropic's own data-handling terms govern what happens to that data on their side — Strike does not have an independent verification of this beyond Anthropic's published policies. *(Owner: confirm the specific Anthropic API data-retention/training-use terms Strike is operating under, and record them in `docs/security/SUBPROCESSORS.md`.)*
- `docs/security/DATA_CLASSIFICATION_RETENTION.md` covers the broader data-classification question this intersects with.

## Model/tool audit trail

- **`agent_actions`** table: the AI action/audit log — action type, entity, reasoning, input/output summaries, `requires_approval`/`human_approved`/`approved_by_user_id`, model name, token count. This is genuinely used, not a stub (referenced across 10+ route/lib files). Historically lost ~22 of ~26 real tool names to a silent enum mismatch until a 2026-07-19 migration fixed it (`apps/web/CLAUDE.md` — worth knowing if auditing older data, since gaps before that date are a known artifact, not evidence of missing governance).
- **What it does not yet capture**: an explicit "override reason" field distinct from the general reasoning text, and a first-class link from a human's approve/reject action back to exactly what the model proposed at that moment (the data exists across `agent_tasks`/`agent_task_messages` but isn't consolidated into one governance-oriented view). Tracked in `docs/enterprise-readiness/ROADMAP.md` 1.J.

## Guardrails that exist today (verified)

- Hard, platform-wide caps on negotiation rounds and deadline (`lib/ai/negotiation-constants.ts`'s `HARD_MAX_ROUNDS`/`HARD_MAX_DEADLINE_DAYS`) — apply regardless of what an org's own plan configures, a backstop against a misconfigured or overly permissive org-level guardrail.
- Per-negotiation "Stop" button (`halt_requested`), checked by the tick loop before every action.
- Global per-org kill switch (`org_agents.is_active`).
- Rate limiting on the AI chat/document/upload/dispatch endpoints (`docs/enterprise-readiness/ASSESSMENT.md` P0-5, fixed in this engagement) — reduces the risk of runaway cost or abuse, a governance-adjacent concern given real API spend is involved.

## Known gaps

- **External dispatch token scoping**: the `/api/ai/dispatch` endpoint's bearer token now supports a `scopes` field at the schema level (`docs/enterprise-readiness/ASSESSMENT.md` P0-4 fix), but per-tool scope enforcement is not yet wired into `executeTool()` — every token today is effectively unrestricted (`'*'`), matching pre-fix behavior. This means a compromised dispatch token can invoke the same tool set as a full session — the fix (hashed storage, expiry, revocation) reduces the *credential compromise* risk but not yet the *blast radius if compromised*. Tracked in `docs/enterprise-readiness/ROADMAP.md` 1.G.
- **No model-output validation beyond the price guardrail** — e.g., no automated check that a generated contract/document's content is factually consistent with the deal record before it's presented to a human. Human review at the approval gates is the current control.
- **No documented AI incident response** — if a model produces a harmful or clearly wrong recommendation, there's no formal process distinct from the general `docs/security/INCIDENT_RESPONSE.md`. Worth a dedicated addendum once there's real usage to learn from.

## Prompt/reasoning data in logs

`apps/web/lib/logger.ts`'s redaction list includes `prompt`/`reasoning`/`input_summary`/`output_summary` as sensitive-key patterns — these are redacted from structured application logs by default. They are **not** redacted from `agent_actions` (which is explicitly designed to store them, as the audit trail) — this is intentional, but means `agent_actions` itself should be treated as Confidential-classification data (see `docs/security/DATA_CLASSIFICATION_RETENTION.md`), scoped by the RLS policies already in place on that table.
