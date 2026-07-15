-- Same issue as room_id: offer-actions.ts writes offer.deal_id on accept, and
-- both the listing detail page's "View Deal" button and agent-tick.ts's
-- reconciliation path read it, but the column never existed — so it always
-- silently failed to write and always read as undefined.
ALTER TABLE public.marketplace_offers ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_deal ON public.marketplace_offers (deal_id) WHERE deal_id IS NOT NULL;
