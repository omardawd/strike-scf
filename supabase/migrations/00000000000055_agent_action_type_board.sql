-- Register the new Board tools in agent_action_type, same reason as every
-- prior ..._agent_action_type_*.sql migration: ALTER TYPE ... ADD VALUE
-- can't share a transaction with a statement referencing the new value.

ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'design_board_workflow';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'create_board_task';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'assign_board_task';
ALTER TYPE public.agent_action_type ADD VALUE IF NOT EXISTS 'move_board_task';
