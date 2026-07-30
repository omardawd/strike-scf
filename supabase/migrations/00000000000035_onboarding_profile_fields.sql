-- The onboarding wizard's "Ownership & Compliance" (step 3) and "Systems & Intent"
-- (step 5) answers, plus the "Payment terms preference" field from step 4, were
-- validated client-side (blocking progression) but never sent to the server —
-- collected in local React state with no column to write to, then discarded on
-- submit. This adds the missing columns so that data actually persists and can
-- be shown to a Strike Admin reviewing a KYB application.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ceo_name                text,
  ADD COLUMN IF NOT EXISTS ubo_summary              text,
  ADD COLUMN IF NOT EXISTS is_pep                   boolean,
  ADD COLUMN IF NOT EXISTS has_sanctioned_exposure   boolean,
  ADD COLUMN IF NOT EXISTS bankruptcy_filed         boolean,
  ADD COLUMN IF NOT EXISTS material_litigation      boolean,
  ADD COLUMN IF NOT EXISTS payment_terms_preference text,
  ADD COLUMN IF NOT EXISTS primary_currency         text,
  ADD COLUMN IF NOT EXISTS avg_invoice_size         text,
  ADD COLUMN IF NOT EXISTS payment_terms_offered    text,
  ADD COLUMN IF NOT EXISTS payment_terms_received   text,
  ADD COLUMN IF NOT EXISTS customer_count           text,
  ADD COLUMN IF NOT EXISTS largest_customer_pct     text,
  ADD COLUMN IF NOT EXISTS financing_need           text,
  ADD COLUMN IF NOT EXISTS supplier_count           text,
  ADD COLUMN IF NOT EXISTS largest_supplier_pct     text,
  ADD COLUMN IF NOT EXISTS supplier_payment_terms   text,
  ADD COLUMN IF NOT EXISTS erp_system               text,
  ADD COLUMN IF NOT EXISTS primary_bank_name        text,
  ADD COLUMN IF NOT EXISTS platform_intent          text[],
  ADD COLUMN IF NOT EXISTS ai_matching_opt_in       boolean;
