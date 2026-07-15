// Platform-wide backstops for autonomous negotiation, independent of any org's
// own price/business guardrails. These exist purely to bound a runaway loop —
// they always apply, even when an org has configured no guardrails at all, and
// the tick loop (app/api/agents/tick/route.ts) enforces them regardless of
// what a plan or Claude proposes.
export const HARD_MAX_ROUNDS = 10
export const HARD_MAX_DEADLINE_DAYS = 14

export const NEGOTIATION_CAPABLE_TOOLS = ['create_marketplace_listing', 'submit_marketplace_offer'] as const
