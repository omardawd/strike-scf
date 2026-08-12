-- PR 3 — register the new pre-award sourcing/award AI tools in the
-- agent_action_type enum (evaluate_listing_offers already registered in
-- migration 032). Separate migration — see CLAUDE.md's note on migration
-- 024/032: ALTER TYPE ADD VALUE can't share a transaction with a statement
-- referencing the new value.
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'find_eligible_suppliers';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'draft_sourcing_request';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'draft_supplier_outreach';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'recommend_award';
