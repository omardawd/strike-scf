-- Autonomous AI agent configuration per org and task queue.
-- Every proposed action requires explicit human approval before execution.

-- One agent per org; activated opt-in
CREATE TABLE IF NOT EXISTS public.org_agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Strike Agent',
  persona     text,
  is_active   boolean NOT NULL DEFAULT false,
  goals       jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_agents_org_id ON public.org_agents (org_id);
CREATE INDEX IF NOT EXISTS idx_org_agents_active ON public.org_agents (is_active) WHERE is_active = true;

-- Every proposal the agent generates must be approved by a human before execution
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type                  text NOT NULL,
  title                 text NOT NULL,
  body                  text,
  proposed_action       jsonb,
  status                text NOT NULL DEFAULT 'awaiting_approval'
                          CHECK (status IN ('awaiting_approval','approved','rejected','completed','failed')),
  result                jsonb,
  approved_by_user_id   uuid REFERENCES public.users(id),
  approved_at           timestamptz,
  rejected_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_org_status ON public.agent_tasks (org_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_pending ON public.agent_tasks (status) WHERE status = 'awaiting_approval';

-- RLS
ALTER TABLE public.org_agents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks  ENABLE ROW LEVEL SECURITY;

-- org_agents: org members can read their own; org_admin can write
CREATE POLICY "org_agents_read_own" ON public.org_agents
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL
    )
  );

CREATE POLICY "org_agents_write_admin" ON public.org_agents
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.users WHERE id = auth.uid() AND role = 'org_admin'
    )
  );

-- agent_tasks: org members can read their own; only the system (service role) inserts
CREATE POLICY "agent_tasks_read_own" ON public.agent_tasks
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL
    )
  );

CREATE POLICY "agent_tasks_update_admin" ON public.agent_tasks
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM public.users WHERE id = auth.uid() AND role = 'org_admin'
    )
  );
