-- Tracks which ERP invoice/order a deal was imported from, so the same
-- ERP record is never imported into Strike as a duplicate deal.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS erp_reference text;
CREATE INDEX IF NOT EXISTS idx_deals_erp_reference ON public.deals (erp_reference) WHERE erp_reference IS NOT NULL;
