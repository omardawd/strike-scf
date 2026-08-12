-- RFx editor now opens empty and lets the user type before ever calling AI —
-- add a 'manual' source, and a doc_type column so the same table/editor backs
-- both RFx drafting and invoice drafting.
ALTER TABLE public.rfx_drafts DROP CONSTRAINT IF EXISTS rfx_drafts_source_check;
ALTER TABLE public.rfx_drafts ADD CONSTRAINT rfx_drafts_source_check
  CHECK (source IN ('ai_generated', 'uploaded', 'manual'));

ALTER TABLE public.rfx_drafts ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'rfx'
  CHECK (doc_type IN ('rfx', 'invoice'));
