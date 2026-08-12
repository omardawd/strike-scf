-- PR 3 — structured quote data on marketplace_offers: stated exceptions to
-- listing terms, and attached quote documents. document_ids is populated
-- exclusively by app/api/marketplace/offers/[id]/documents/route.ts (server-
-- appended on upload), never trusted from client-supplied offer bodies.
ALTER TABLE public.marketplace_offers
  ADD COLUMN "exceptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "document_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[];
