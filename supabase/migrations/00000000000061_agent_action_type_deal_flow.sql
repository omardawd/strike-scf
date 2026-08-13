-- Adds the draft_deal_flow AI tool to the agent_action_type enum so its
-- executions get logged to agent_actions (fail-soft catch would otherwise
-- silently swallow every call — see CLAUDE.md's "AI limits & logging").
-- Separate migration: ALTER TYPE ... ADD VALUE can't share a transaction
-- with a statement referencing the new value.

ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'draft_deal_flow';
