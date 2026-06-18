-- Store Strike AI's reasoning text for the passport score
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS passport_score_reasoning TEXT;
