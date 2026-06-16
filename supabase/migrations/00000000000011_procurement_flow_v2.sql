-- Procurement Flow v2: line items, bank account on offers, contract columns, new deal status

-- 1. listing_line_items table
CREATE TABLE IF NOT EXISTS listing_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  quantity        NUMERIC,
  unit            TEXT,
  unit_price      NUMERIC,
  currency        TEXT NOT NULL DEFAULT 'USD',
  specs           JSONB NOT NULL DEFAULT '[]',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS listing_line_items_listing_idx ON listing_line_items (listing_id, sort_order);

ALTER TABLE listing_line_items ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view line items
CREATE POLICY "line_items_select_authenticated" ON listing_line_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only listing org members can insert/update/delete
CREATE POLICY "line_items_write_org" ON listing_line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM marketplace_listings ml
      JOIN users u ON u.org_id = ml.org_id
      WHERE ml.id = listing_line_items.listing_id
        AND u.id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER listing_line_items_updated_at
  BEFORE UPDATE ON listing_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. bank_account_id on marketplace_offers
ALTER TABLE marketplace_offers ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;

-- 3. deal_status enum: add contract_pending
ALTER TYPE deal_status ADD VALUE IF NOT EXISTS 'contract_pending' AFTER 'agreed';

-- 4. deal columns for contract, invoice, and bank contract
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS receiving_bank_account_id    UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_document_id         UUID,
  ADD COLUMN IF NOT EXISTS contract_generated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_submitted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_submitted_by        UUID,
  ADD COLUMN IF NOT EXISTS contract_supplier_signature  TEXT,
  ADD COLUMN IF NOT EXISTS contract_supplier_signed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deal_invoice_document_id     UUID,
  ADD COLUMN IF NOT EXISTS deal_invoice_number          TEXT,
  ADD COLUMN IF NOT EXISTS deal_invoice_generated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_contract_document_id    UUID,
  ADD COLUMN IF NOT EXISTS bank_contract_submitted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_contract_submitted_by   UUID,
  ADD COLUMN IF NOT EXISTS bank_contract_signature      TEXT,
  ADD COLUMN IF NOT EXISTS bank_contract_signed_by      UUID,
  ADD COLUMN IF NOT EXISTS bank_contract_signed_at      TIMESTAMPTZ;
