-- Register the new sourcing tools in agent_action_type, same reason as
-- migrations 024/032/051 — ALTER TYPE ADD VALUE can't share a transaction
-- with a statement referencing the new value.
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'request_sourcing_search';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_sourcing_search_status';
