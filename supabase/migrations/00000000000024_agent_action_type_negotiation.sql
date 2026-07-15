-- agent_action_type didn't cover any real tool name (create_marketplace_listing,
-- submit_marketplace_offer, create_financing_request), so every agent_actions
-- insert using a tool name as action_type has been silently failing (both call
-- sites swallow the insert error) — the audit trail has been empty in practice.
-- ALTER TYPE ... ADD VALUE must run in its own migration, separate from any
-- statement that references the new value.
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'create_marketplace_listing';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'create_financing_request';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'submit_marketplace_offer';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_listing_posted';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_offer_submitted';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_countered';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_ready_to_finalize';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_accepted';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_rejected';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_escalated';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'negotiation_halted';
