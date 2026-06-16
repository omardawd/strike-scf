-- documents.entity_type is missing 'listing': the marketplace listing document
-- upload route (app/api/marketplace/listings/[id]/document/route.ts) inserts with
-- entity_type='listing', which has been silently failing since the enum only had
-- 'organization', 'transaction', 'deal', 'financing_request', 'room'.
ALTER TYPE public.document_entity_type ADD VALUE IF NOT EXISTS 'listing';
