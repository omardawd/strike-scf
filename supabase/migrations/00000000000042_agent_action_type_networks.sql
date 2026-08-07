-- Adds the two new Strike AI network-management tool names to
-- agent_action_type so their agent_actions log entries don't silently fail
-- (see migration 032's note — this enum must stay in sync with ToolName).
ALTER TYPE agent_action_type ADD VALUE IF NOT EXISTS 'create_network';
ALTER TYPE agent_action_type ADD VALUE IF NOT EXISTS 'add_network_member';
