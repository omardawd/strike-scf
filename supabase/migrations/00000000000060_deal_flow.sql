-- Deal flow builder: a per-deal, buyer-authored progress flow that replaces
-- the flat deal_workflow_steps checklist with a graph of steps and
-- repeating "cycle" nodes (e.g. 12 shipments every 60 days). This is a
-- richer, additive tracking layer alongside DealRoadmap/deals.status — it
-- does NOT drive deal.status or any transition/financing logic. See
-- apps/web/lib/deals/flow.ts.
--
-- deal_workflow_steps is intentionally left in place (not dropped) so any
-- pre-existing deal's historical rows stay readable; new UI reads/writes
-- only the tables below.

CREATE TABLE public.deal_flow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'default' CHECK (source IN ('default', 'ai_drafted', 'manual', 'ai_then_manual')),
  locked_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_deal_flow_templates_updated_at
  BEFORE UPDATE ON public.deal_flow_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Polymorphic node table: a 'step' is a single checkpoint; a 'cycle' is a
-- repeating group of shipments/payments authored as ONE unit (repeat_count
-- occurrences materialized into deal_flow_cycle_occurrences below) rather
-- than forcing the buyer to create N near-duplicate step nodes.
CREATE TABLE public.deal_flow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_template_id UUID NOT NULL REFERENCES public.deal_flow_templates(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('step', 'cycle')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT,
  responsible_party TEXT NOT NULL DEFAULT 'both' CHECK (responsible_party IN ('buyer', 'supplier', 'both')),
  requires_document BOOLEAN NOT NULL DEFAULT false,
  position_x DOUBLE PRECISION,
  position_y DOUBLE PRECISION,
  position INTEGER NOT NULL DEFAULT 0,
  -- cycle-only fields (NULL for node_type = 'step')
  repeat_count INTEGER CHECK (repeat_count > 0),
  repeat_interval_days INTEGER CHECK (repeat_interval_days > 0),
  anchor_date DATE,
  -- lifecycle (steps use the full vocabulary; cycle nodes stay 'accepted'
  -- once saved — the per-occurrence table tracks completion granularity)
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'declined', 'completed')),
  due_at TIMESTAMPTZ,
  proposed_by_user_id UUID REFERENCES public.users(id),
  proposed_by_org_id UUID REFERENCES public.organizations(id),
  responded_at TIMESTAMPTZ,
  responded_by_user_id UUID REFERENCES public.users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (node_type = 'step') OR
    (node_type = 'cycle' AND repeat_count IS NOT NULL AND repeat_interval_days IS NOT NULL AND anchor_date IS NOT NULL)
  )
);

CREATE INDEX deal_flow_nodes_template_idx ON public.deal_flow_nodes (flow_template_id, position);

CREATE TRIGGER trg_deal_flow_nodes_updated_at
  BEFORE UPDATE ON public.deal_flow_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.deal_flow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_template_id UUID NOT NULL REFERENCES public.deal_flow_templates(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES public.deal_flow_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES public.deal_flow_nodes(id) ON DELETE CASCADE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id),
  CHECK (from_node_id != to_node_id)
);

CREATE INDEX deal_flow_edges_template_idx ON public.deal_flow_edges (flow_template_id);

-- One row per occurrence of a 'cycle' node (e.g. shipment 1..12). due_at is
-- computed once at creation from anchor_date + (n-1)*repeat_interval_days
-- and stored, not recomputed on read, so editing anchor_date later doesn't
-- silently reflow already-completed occurrences.
CREATE TABLE public.deal_flow_cycle_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_node_id UUID NOT NULL REFERENCES public.deal_flow_nodes(id) ON DELETE CASCADE,
  occurrence_index INTEGER NOT NULL CHECK (occurrence_index > 0),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_node_id, occurrence_index)
);

CREATE INDEX deal_flow_cycle_occurrences_node_idx ON public.deal_flow_cycle_occurrences (cycle_node_id, occurrence_index);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Party-scoped, mirroring deal_workflow_steps: buyer authors (insert/full
-- replace happens via the service-role client in lib/deals/flow.ts, so the
-- write policy just needs to cover status-response updates from either
-- party plus admin bypass), both parties read.

ALTER TABLE public.deal_flow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_flow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_flow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_flow_cycle_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_flow_templates_party_read" ON public.deal_flow_templates
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_flow_templates.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_templates_party_write" ON public.deal_flow_templates
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_flow_templates.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_flow_templates.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_nodes_party_read" ON public.deal_flow_nodes
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_nodes.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_nodes_party_write" ON public.deal_flow_nodes
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_nodes.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_nodes.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_edges_party_read" ON public.deal_flow_edges
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_edges.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_edges_party_write" ON public.deal_flow_edges
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_edges.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_templates t JOIN public.deals ON deals.id = t.deal_id
      WHERE t.id = deal_flow_edges.flow_template_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_cycle_occurrences_party_read" ON public.deal_flow_cycle_occurrences
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_nodes n
      JOIN public.deal_flow_templates t ON t.id = n.flow_template_id
      JOIN public.deals ON deals.id = t.deal_id
      WHERE n.id = deal_flow_cycle_occurrences.cycle_node_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );

CREATE POLICY "deal_flow_cycle_occurrences_party_write" ON public.deal_flow_cycle_occurrences
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_nodes n
      JOIN public.deal_flow_templates t ON t.id = n.flow_template_id
      JOIN public.deals ON deals.id = t.deal_id
      WHERE n.id = deal_flow_cycle_occurrences.cycle_node_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_nodes n
      JOIN public.deal_flow_templates t ON t.id = n.flow_template_id
      JOIN public.deals ON deals.id = t.deal_id
      WHERE n.id = deal_flow_cycle_occurrences.cycle_node_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  );
