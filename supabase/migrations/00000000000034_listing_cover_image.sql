-- Adds a cover image to marketplace listings — Strike Place currently has zero image
-- support anywhere (listings, line items, or organizations besides an unused logo_url),
-- making every card/detail page pure text. This is the minimum column needed to render
-- a photo on listing cards and the listing detail page.
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS cover_image_url text;
