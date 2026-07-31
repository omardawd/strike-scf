-- Expands listing images from a single cover_image_url to up to 3 ordered images.
-- image_urls[0] stays mirrored into cover_image_url so existing readers (passport
-- product catalog, financing pages) keep working unchanged.
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

UPDATE public.marketplace_listings
SET image_urls = ARRAY[cover_image_url]
WHERE cover_image_url IS NOT NULL AND image_urls = '{}';
