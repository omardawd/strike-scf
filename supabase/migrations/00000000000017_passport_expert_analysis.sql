-- Stores the full structured expert analysis produced by Claude Sonnet
-- when reading all KYB documents. Includes per-dimension scores with
-- reasoning, document findings, strengths, risk flags, and improvement actions.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS passport_expert_analysis jsonb;
