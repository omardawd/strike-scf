-- The stateful negotiation *process* that runs after a plan is approved, kept
-- separate from agent_tasks (which stays a thin "one human decision" record,
-- consistent with how deals/financing_requests are already split in this schema).
CREATE TABLE public.agent_negotiations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_task_id         uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id            uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  offer_id              uuid REFERENCES public.marketplace_offers(id) ON DELETE SET NULL,
  deal_id               uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN (
                          'active','awaiting_finalization','halted_by_user','halted_guardrail',
                          'completed_accepted','completed_rejected','completed_withdrawn',
                          'completed_deadline','failed')),
  current_round         integer NOT NULL DEFAULT 0,
  last_seen_offer_round integer,
  last_tick_at          timestamptz,
  history               jsonb NOT NULL DEFAULT '[]',
  halt_requested        boolean NOT NULL DEFAULT false,
  halt_requested_by     uuid REFERENCES public.users(id),
  outcome_summary       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_agent_negotiations_offer ON public.agent_negotiations (offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX idx_agent_negotiations_active ON public.agent_negotiations (status) WHERE status = 'active';
CREATE INDEX idx_agent_negotiations_org ON public.agent_negotiations (org_id);
CREATE INDEX idx_agent_negotiations_task ON public.agent_negotiations (agent_task_id);

ALTER TABLE public.agent_negotiations ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's negotiations.
CREATE POLICY "agent_negotiations_select_own_org" ON public.agent_negotiations
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL)
  );

-- Only org_admin can update (used for the "Stop negotiation" halt_requested flag).
CREATE POLICY "agent_negotiations_update_org_admin" ON public.agent_negotiations
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid() AND role = 'org_admin')
  );

-- No INSERT/DELETE policy for authenticated users — rows are only ever created
-- by the service-role client (approve route, tick route), same pattern as agent_tasks.

CREATE TRIGGER trg_agent_negotiations_updated_at
  BEFORE UPDATE ON public.agent_negotiations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
