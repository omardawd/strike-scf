-- Shipping cost: supplier-specified freight cost when the chosen incoterm puts
-- main-carriage on the seller (CFR, CIF, CPT, CIP, DAP, DPU, DDP). Captured on the
-- listing (product_service — supplier is poster) or the offer (po_request —
-- supplier is offeror), then carried onto the deal at offer acceptance.

ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC;
ALTER TABLE marketplace_offers   ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC;
ALTER TABLE deals                ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC;
