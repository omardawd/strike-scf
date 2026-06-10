-- G1.3 — New deal flow: two-part goods confirmation + payment info submission step.

-- New enum values
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'goods_received';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'payment_info_sent';

-- Goods receipt (buyer confirms goods arrived)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS goods_received_at TIMESTAMPTZ;
-- Goods condition (buyer confirms goods are as described)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS goods_confirmed_at TIMESTAMPTZ;

-- Payment info submission (supplier or bank sends their bank details)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_info_sent_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_info_sent_by UUID;

-- Document confirmation timestamps (Scenario A: supplier confirms PO; Scenario B: buyer confirms invoice)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS po_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS invoice_confirmed_at TIMESTAMPTZ;
