-- Associates a custom deal_flow_nodes row with one of DealRoadmap.tsx's 8
-- fixed lifecycle stages, so a custom checkpoint or repeating cycle (e.g. a
-- "Shipment" cycle) surfaces when the buyer/supplier clicks that stage on
-- the roadmap, instead of living in a separate always-visible list. Nullable
-- — lib/deals/flow.ts always fills a best-guess value on write (exact title
-- match against the fixed labels, then keyword heuristics, defaulting to
-- 'confirmed' for anything unclassifiable), but the column stays nullable
-- since it's a derived convenience field, not a hard invariant.

ALTER TABLE public.deal_flow_nodes
  ADD COLUMN roadmap_stage TEXT
    CHECK (roadmap_stage IN (
      'agreed', 'contract_pending', 'confirmed', 'shipped',
      'goods_received', 'delivery_confirmed', 'payment_confirmed', 'completed'
    ));

CREATE INDEX deal_flow_nodes_roadmap_stage_idx ON public.deal_flow_nodes (flow_template_id, roadmap_stage);
