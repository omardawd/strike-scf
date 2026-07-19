-- agent_actions.action_type has historically only tracked a handful of hand-picked
-- values, but every AI chat/dispatch tool call logs action_type = the real tool name
-- (see app/api/ai/chat/route.ts, app/api/ai/dispatch/route.ts). Any tool name not in
-- this enum silently fails the insert (22P02) and the audit trail is missing that
-- action entirely. Add every ToolName from lib/ai/tools/execute.ts that isn't already
-- a value here.
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_agent_tasks';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'counter_marketplace_offer';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'accept_marketplace_offer';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'reject_marketplace_offer';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'evaluate_supplier_passport';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'find_and_recommend_deals';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_pricing_insights';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'summarize_deal_negotiation';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'score_and_rank_financing_offers';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'detect_deal_risk_signals';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'recommend_suppliers_for_buyer';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'generate_deal_term_sheet';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'proactive_portfolio_alerts';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'lookup_entities';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'evaluate_listing_offers';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_passport_advice';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_active_deals';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'search_marketplace_listings';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'search_web';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_financing_programs';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_erp_data';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'get_capital_position';
