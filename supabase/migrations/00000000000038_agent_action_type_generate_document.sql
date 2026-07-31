-- Adds 'generate_document' to agent_action_type so the new Strike AI document/
-- export tool logs to agent_actions instead of silently hitting 22P02 (see
-- migration 032's note on this exact failure mode for previously-added tools).
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'generate_document';
