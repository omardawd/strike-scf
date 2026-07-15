-- The original unique index assumed one agent_negotiations row per offer
-- platform-wide, but agent-to-agent negotiation legitimately needs TWO rows
-- referencing the same marketplace_offers row — one per participating org,
-- each tracking its own side/turn of the same negotiation. Replace the
-- globally-unique index with one unique per (org_id, offer_id) instead.
DROP INDEX IF EXISTS public.idx_agent_negotiations_offer;
CREATE UNIQUE INDEX idx_agent_negotiations_offer_per_org ON public.agent_negotiations (org_id, offer_id) WHERE offer_id IS NOT NULL;
