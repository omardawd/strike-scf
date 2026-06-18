-- Add passport_ai_evaluated_at to track when AI last scored this org's passport
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS passport_ai_evaluated_at TIMESTAMPTZ;
