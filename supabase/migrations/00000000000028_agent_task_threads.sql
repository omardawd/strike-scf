-- Links a follow-up agent_tasks row (negotiation_escalation, negotiation_ready_to_finalize)
-- back to the original GATE-1 task that started the thread, so the UI can group
-- an entire negotiation lineage into one conversation. NULL means this task IS
-- the root of its own thread.
ALTER TABLE public.agent_tasks ADD COLUMN root_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE CASCADE;
CREATE INDEX idx_agent_tasks_root ON public.agent_tasks (root_task_id) WHERE root_task_id IS NOT NULL;

-- Per-thread chat history. agent_task_id always points at the ROOT task of the
-- thread (never a follow-up task's own id) so reading a thread is one simple
-- query regardless of how many agent_tasks rows the negotiation has produced.
CREATE TABLE public.agent_task_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_task_id  uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_task_messages_task ON public.agent_task_messages (agent_task_id, created_at);

ALTER TABLE public.agent_task_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_task_messages_select_own_org" ON public.agent_task_messages
  FOR SELECT USING (
    agent_task_id IN (
      SELECT id FROM public.agent_tasks
      WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL)
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated users — rows are only ever
-- created by the service-role client (messages route, approve/reject routes,
-- tick route), same pattern as agent_tasks/agent_negotiations.
