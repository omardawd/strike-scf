-- Draft RFx: AI-assisted RFx (RFQ/RFP) drafting/evaluation for Strike Place
-- po_request listings and deal contract submission.
CREATE TABLE IF NOT EXISTS public.rfx_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  created_by        uuid REFERENCES users(id),
  entity_type       text NOT NULL CHECK (entity_type IN ('listing', 'deal')),
  entity_id         uuid, -- nullable: a new listing doesn't exist yet when drafting starts
  source            text NOT NULL CHECK (source IN ('ai_generated', 'uploaded')),
  title             text,
  content           text NOT NULL DEFAULT '',
  content_version   integer NOT NULL DEFAULT 1,
  overall_score     integer CHECK (overall_score BETWEEN 0 AND 100),
  section_scores    jsonb,
  highlights        jsonb NOT NULL DEFAULT '[]',
  price_assessment  jsonb,
  ai_scored         boolean NOT NULL DEFAULT false,
  document_id       uuid REFERENCES documents(id),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfx_drafts_org ON public.rfx_drafts(org_id);
CREATE INDEX IF NOT EXISTS idx_rfx_drafts_entity ON public.rfx_drafts(entity_type, entity_id);

ALTER TABLE public.rfx_drafts ENABLE ROW LEVEL SECURITY;

-- Org members can read/write their own org's drafts. Writes/reads for the
-- 'deal' entity_type are additionally scoped in the API layer (buyer-or-
-- supplier-on-the-deal check via the admin client), same convention as the
-- rest of this codebase's deal routes.
CREATE POLICY "rfx_drafts_org_select" ON public.rfx_drafts
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "rfx_drafts_org_insert" ON public.rfx_drafts
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "rfx_drafts_org_update" ON public.rfx_drafts
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );
