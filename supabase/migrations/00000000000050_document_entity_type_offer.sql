-- PR 3 — supplier quote documents attached to a marketplace_offer.
ALTER TYPE public.document_entity_type ADD VALUE IF NOT EXISTS 'offer';
