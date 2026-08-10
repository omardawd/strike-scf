CREATE TABLE public.deal_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT,
  responsible_party TEXT NOT NULL CHECK (responsible_party IN ('buyer', 'supplier', 'both')),
  requires_document BOOLEAN NOT NULL DEFAULT false,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'declined', 'completed')),
  proposed_by_user_id UUID NOT NULL REFERENCES public.users(id),
  proposed_by_org_id UUID NOT NULL REFERENCES public.organizations(id),
  responded_at TIMESTAMPTZ,
  responded_by_user_id UUID REFERENCES public.users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, position)
);

CREATE INDEX deal_workflow_steps_deal_idx
  ON public.deal_workflow_steps (deal_id, position);

CREATE TRIGGER trg_deal_workflow_steps_updated_at
  BEFORE UPDATE ON public.deal_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.deal_workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_workflow_steps_party_read" ON public.deal_workflow_steps
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_workflow_steps.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_workflow_steps_buyer_insert" ON public.deal_workflow_steps
  FOR INSERT TO public WITH CHECK (
    proposed_by_org_id = current_org_id() AND EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_workflow_steps.deal_id
        AND deals.buyer_org_id = current_org_id()
    )
  );

CREATE POLICY "deal_workflow_steps_party_update" ON public.deal_workflow_steps
  FOR UPDATE TO public USING (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_workflow_steps.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );
