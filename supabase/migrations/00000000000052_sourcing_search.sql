-- Strike Sourcing — a staged, resumable "deep research" supplier-discovery job.
-- One row per user request; sourcing_candidates holds normalized per-supplier
-- results (real columns for facts we'll want to query/report on, jsonb only
-- for the heterogeneous evidence/extraction payload). Kept intentionally
-- smaller than a full sourcing-OS schema (no outreach/RFQ tables yet) — this
-- backs the discovery-only prototype tested inside /ai before a standalone
-- product is scoped.

CREATE TABLE public.sourcing_searches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id  uuid NOT NULL REFERENCES public.users(id),
  raw_query             text NOT NULL,
  requirements          jsonb,              -- {required, preferred, secondary, disqualifiers, unknowns}
  stage                 text NOT NULL DEFAULT 'parsing_requirements' CHECK (stage IN (
                          'parsing_requirements', 'discovering', 'shortlisting',
                          'extracting', 'ranking', 'completed', 'failed'
                        )),
  round                 integer NOT NULL DEFAULT 0,
  max_rounds            integer NOT NULL DEFAULT 3,
  extract_cursor        integer NOT NULL DEFAULT 0,  -- index into shortlisted candidates already deep-extracted
  summary               text,               -- short buyer-facing summary, written at 'completed'
  error                 text,
  claimed_at            timestamptz,        -- atomic-claim guard, same pattern as agent_negotiations.last_tick_at
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sourcing_searches_org ON public.sourcing_searches (org_id, created_at DESC);
CREATE INDEX idx_sourcing_searches_active ON public.sourcing_searches (stage) WHERE stage NOT IN ('completed', 'failed');

ALTER TABLE public.sourcing_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sourcing_searches_select_own_org" ON public.sourcing_searches
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL)
  );

-- No INSERT/UPDATE/DELETE policy for authenticated users — rows are only ever
-- written by the service-role client (tool handler, advance route), same
-- pattern as agent_negotiations/agent_tasks.

CREATE TRIGGER trg_sourcing_searches_updated_at
  BEFORE UPDATE ON public.sourcing_searches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


CREATE TABLE public.sourcing_candidates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id                 uuid NOT NULL REFERENCES public.sourcing_searches(id) ON DELETE CASCADE,
  source                    text NOT NULL CHECK (source IN ('strike_place', 'exa', 'tavily')),
  source_url                text,               -- null for strike_place candidates (use listing_id instead)
  domain                    text,
  title                     text,
  discovery_snippet         text,               -- search-provider highlight/snippet, kept for audit
  listing_id                uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  status                    text NOT NULL DEFAULT 'discovered' CHECK (status IN (
                              'discovered', 'shortlisted', 'extracted', 'extraction_failed', 'rejected'
                            )),
  -- Evidence-backed extraction payload — array of
  -- {field, value, unit, evidence_quote, source_url, retrieved_at, status: 'advertised'|'confirmed'|'inferred', confidence}.
  -- Kept as jsonb: fields are heterogeneous per product category (an ice-cream
  -- scoop and a steel coil don't share a schema), unlike the three scores below
  -- which are always present and always worth indexing/reporting on.
  extracted_fields          jsonb NOT NULL DEFAULT '[]',
  spec_match_score          numeric,            -- 0-100, required/preferred/secondary criteria satisfaction
  commercial_score          numeric,            -- 0-100, price/MOQ/lead-time attractiveness
  supplier_confidence_score numeric,            -- 0-100, informational signal strength only — never real KYB/trust
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sourcing_candidates_search ON public.sourcing_candidates (search_id, status);
-- Deliberately NOT a partial index (no WHERE domain IS NOT NULL) — Postgres's
-- ON CONFLICT (search_id, domain) target inference only matches non-partial
-- unique indexes/constraints on those exact columns; a partial index here
-- makes every upsert() error with "no unique or exclusion constraint
-- matching the ON CONFLICT specification", which Supabase's JS client does
-- NOT throw on by default — the upsert silently no-ops instead. Confirmed
-- live: this was WHY the discovery stage ran all 3 rounds successfully
-- (real Exa/Tavily hits) but zero sourcing_candidates rows ever landed.
-- A plain unique index still works for our purposes: Postgres treats every
-- NULL domain (the Strike Place candidates) as distinct from every other
-- NULL by default, so same-org multiple NULL-domain rows never conflict.
CREATE UNIQUE INDEX idx_sourcing_candidates_dedupe ON public.sourcing_candidates (search_id, domain);

ALTER TABLE public.sourcing_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sourcing_candidates_select_own_org" ON public.sourcing_candidates
  FOR SELECT USING (
    search_id IN (
      SELECT id FROM public.sourcing_searches
      WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL)
    )
  );

CREATE TRIGGER trg_sourcing_candidates_updated_at
  BEFORE UPDATE ON public.sourcing_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Separate migration for the enum additions — ALTER TYPE ... ADD VALUE can't
-- share a transaction with a statement referencing the new value (see 024/032).
