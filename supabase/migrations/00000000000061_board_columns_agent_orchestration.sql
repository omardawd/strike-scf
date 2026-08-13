-- Column-level agent orchestration: a stage can auto-assign any task that
-- enters it to a designated agent (the "this stage IS the sourcing agent's
-- queue" model), and/or require a human to take explicit ownership (reassign
-- away from an agent) before a task can leave it — the structural form of
-- "a human reviews the agent's work before handing it to the next step."
-- Both are optional and independent per column; an admin can chain
-- agent-stage -> review-stage -> agent-stage -> ... -> one final approval,
-- or require review after every single stage, however they configure the
-- workflow.

ALTER TABLE public.board_columns
  ADD COLUMN auto_assign_agent_id UUID REFERENCES public.board_agents(id) ON DELETE SET NULL,
  ADD COLUMN requires_review BOOLEAN NOT NULL DEFAULT false;
