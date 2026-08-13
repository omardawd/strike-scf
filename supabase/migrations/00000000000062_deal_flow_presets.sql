-- Reusable, org-owned deal flow "templates" — saved from a deal's customized
-- flow (or built standalone) and applied to a NEW deal instead of starting
-- from scratch every time. Deliberately decoupled from any specific deal
-- (unlike deal_flow_templates, which is 1:1 with a deal) — this is a library
-- an org builds up over time. See apps/web/lib/deals/flow-presets.ts.
--
-- Cycle nodes here carry no anchor_date (a saved template has no real start
-- date yet) — applying a preset seeds a sensible default (today) that the
-- buyer adjusts in the canvas before saving, same as a freshly added cycle
-- node already works.

CREATE TABLE public.deal_flow_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX deal_flow_presets_org_idx ON public.deal_flow_presets (org_id);

CREATE TRIGGER trg_deal_flow_presets_updated_at
  BEFORE UPDATE ON public.deal_flow_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.deal_flow_preset_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES public.deal_flow_presets(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('step', 'cycle')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT,
  responsible_party TEXT NOT NULL DEFAULT 'both' CHECK (responsible_party IN ('buyer', 'supplier', 'both')),
  requires_document BOOLEAN NOT NULL DEFAULT false,
  position_x DOUBLE PRECISION,
  position_y DOUBLE PRECISION,
  position INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER CHECK (repeat_count > 0),
  repeat_interval_days INTEGER CHECK (repeat_interval_days > 0),
  CHECK (
    (node_type = 'step') OR
    (node_type = 'cycle' AND repeat_count IS NOT NULL AND repeat_interval_days IS NOT NULL)
  )
);

CREATE INDEX deal_flow_preset_nodes_preset_idx ON public.deal_flow_preset_nodes (preset_id, position);

CREATE TABLE public.deal_flow_preset_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES public.deal_flow_presets(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES public.deal_flow_preset_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES public.deal_flow_preset_nodes(id) ON DELETE CASCADE,
  label TEXT,
  UNIQUE (from_node_id, to_node_id),
  CHECK (from_node_id != to_node_id)
);

CREATE INDEX deal_flow_preset_edges_preset_idx ON public.deal_flow_preset_edges (preset_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Org-scoped (any member of the org may save/apply/delete a preset — this is
-- a personal-productivity library, not a per-deal negotiated artifact, so it
-- doesn't need the buyer-only restriction deal_flow_nodes has).

ALTER TABLE public.deal_flow_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_flow_preset_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_flow_preset_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_flow_presets_org_read" ON public.deal_flow_presets
  FOR SELECT TO public USING (is_strike_admin() OR org_id = current_org_id());

CREATE POLICY "deal_flow_presets_org_write" ON public.deal_flow_presets
  FOR ALL TO public USING (is_strike_admin() OR org_id = current_org_id())
  WITH CHECK (is_strike_admin() OR org_id = current_org_id());

CREATE POLICY "deal_flow_preset_nodes_org_read" ON public.deal_flow_preset_nodes
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_nodes.preset_id AND p.org_id = current_org_id()
    )
  );

CREATE POLICY "deal_flow_preset_nodes_org_write" ON public.deal_flow_preset_nodes
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_nodes.preset_id AND p.org_id = current_org_id()
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_nodes.preset_id AND p.org_id = current_org_id()
    )
  );

CREATE POLICY "deal_flow_preset_edges_org_read" ON public.deal_flow_preset_edges
  FOR SELECT TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_edges.preset_id AND p.org_id = current_org_id()
    )
  );

CREATE POLICY "deal_flow_preset_edges_org_write" ON public.deal_flow_preset_edges
  FOR ALL TO public USING (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_edges.preset_id AND p.org_id = current_org_id()
    )
  ) WITH CHECK (
    is_strike_admin() OR EXISTS (
      SELECT 1 FROM public.deal_flow_presets p
      WHERE p.id = deal_flow_preset_edges.preset_id AND p.org_id = current_org_id()
    )
  );
