-- Audit trail of agent runs on a board task. Pressing "Run Agent" on a task
-- assigned to a board_agents row calls Claude once (persona + guardrails +
-- task context in, structured findings out) and stores the result here —
-- never mutates the task itself or any other table. A human reads the
-- findings, then does the follow-up work themselves (revise the task,
-- move it to the next stage, hand it to another agent). Multiple rows can
-- exist per task: every run is kept, newest first, so nothing is silently
-- overwritten and the trail stays auditable across handoffs.

CREATE TABLE public.board_task_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.board_tasks(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.board_agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  output JSONB,
  error TEXT,
  model TEXT,
  run_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_task_agent_runs_task_idx ON public.board_task_agent_runs (task_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Tenancy scoped through the parent task's board, same pattern as
-- board_task_checklist_items/board_task_comments.

ALTER TABLE public.board_task_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_task_agent_runs_scoped_read" ON public.board_task_agent_runs
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_agent_runs.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );

CREATE POLICY "board_task_agent_runs_scoped_write" ON public.board_task_agent_runs
  FOR ALL TO public USING (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_agent_runs.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.board_tasks
      JOIN public.boards ON boards.id = board_tasks.board_id
      WHERE board_tasks.id = board_task_agent_runs.task_id
        AND ((boards.org_id = current_org_id()) OR (boards.bank_id = current_bank_id()) OR is_strike_admin())
    )
  );
