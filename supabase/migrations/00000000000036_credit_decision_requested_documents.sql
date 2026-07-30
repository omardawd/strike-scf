ALTER TABLE public.credit_decision_records
  ADD COLUMN IF NOT EXISTS requested_documents jsonb;
