-- G1.1: Add missing deal status enum values for the full procurement flow.
-- ALTER TYPE ... ADD VALUE cannot be rolled back; run this migration first.

ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'in_preparation';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'shipped';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'delivery_confirmed';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'in_dispute';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'payment_due';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'payment_overdue';
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'payment_confirmed';
