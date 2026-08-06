-- Adds a nullable network_id to rooms so a network can have its own persistent
-- private room (one per network, membership synced to active network members)
-- distinct from deal-scoped private rooms and ad-hoc public rooms.
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS network_id uuid REFERENCES public.anchor_networks(id) ON DELETE CASCADE;

-- Enforce at most one room per network.
CREATE UNIQUE INDEX IF NOT EXISTS rooms_network_id_unique_idx ON public.rooms (network_id) WHERE network_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_network_id ON public.rooms (network_id) WHERE network_id IS NOT NULL;
