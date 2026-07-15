-- marketplace_offers never had a metadata column — offer-actions.ts (and the
-- route it was refactored from) has always written/read offer.metadata.room_id
-- to make ensureRoom() idempotent, but since that column doesn't exist, every
-- write silently failed and every counter-offer/accept spawned a BRAND NEW
-- room instead of reusing one. Add a real column instead of a fake jsonb field.
ALTER TABLE public.marketplace_offers ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_room ON public.marketplace_offers (room_id) WHERE room_id IS NOT NULL;
