-- Board AI agents: named, org/bank-scoped configured agents (persona +
-- task types + expected output + guardrails) that can be assigned to a
-- board task alongside a human teammate. This migration + the CRUD API only
-- cover configuring agents and assigning them to tasks — actual execution
-- (an agent drafting work into a task for human approval, reusing the
-- existing agent_tasks queue) is a deliberately separate follow-up, same
-- human-in-the-loop principle as the rest of the Autonomous Agent Manager.
-- Deliberately a separate table from org_agents (which stays the single
-- opt-in "org copilot" persona) rather than repurposing it — org_agents is
-- UNIQUE per org and has no task_types/expected_output/guardrails shape.

CREATE TABLE public.board_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_id UUID REFERENCES public.banks(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  role_label TEXT CHECK (role_label IS NULL OR char_length(role_label) <= 60),
  persona TEXT CHECK (persona IS NULL OR char_length(persona) <= 4000),
  task_types TEXT[] NOT NULL DEFAULT '{}',
  expected_output TEXT CHECK (expected_output IS NULL OR char_length(expected_output) <= 2000),
  guardrails TEXT CHECK (guardrails IS NULL OR char_length(guardrails) <= 4000),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((org_id IS NOT NULL) OR (bank_id IS NOT NULL))
);

CREATE INDEX board_agents_org_idx ON public.board_agents (org_id);
CREATE INDEX board_agents_bank_idx ON public.board_agents (bank_id);

CREATE TRIGGER trg_board_agents_updated_at
  BEFORE UPDATE ON public.board_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- A board task's assignee is either a human (assignee_user_id) or a
-- configured agent (assignee_agent_id), never both.
ALTER TABLE public.board_tasks
  ADD COLUMN assignee_agent_id UUID REFERENCES public.board_agents(id) ON DELETE SET NULL,
  ADD CONSTRAINT board_tasks_single_assignee
    CHECK (assignee_user_id IS NULL OR assignee_agent_id IS NULL);

CREATE INDEX board_tasks_assignee_agent_idx ON public.board_tasks (assignee_agent_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Tenancy-only, same convention as boards/board_tasks — role gating (only
-- org/bank admins may create/edit/delete agents) lives in the API layer.

ALTER TABLE public.board_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_agents_scoped_read" ON public.board_agents
  FOR SELECT TO public USING (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  );

CREATE POLICY "board_agents_scoped_write" ON public.board_agents
  FOR ALL TO public USING (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  ) WITH CHECK (
    (org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()
  );
