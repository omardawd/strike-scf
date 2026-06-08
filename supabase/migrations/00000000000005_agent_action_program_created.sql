-- TRACK-C / TC.5 — Strike AI "Create Program" mid-flow logs to agent_actions.
-- The agent_action_type enum has no value covering program creation, so add one.
-- ADD VALUE must be its own statement (cannot be used in the same tx it is created in).

ALTER TYPE agent_action_type ADD VALUE IF NOT EXISTS 'program_created';
