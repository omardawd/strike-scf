-- G1.2: Add operational columns to deals table + create deal_events audit table.

-- Shipment details
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS shipment_tracking_ref TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS shipment_carrier TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS shipment_estimated_delivery DATE;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

-- Commercial invoice (the financing instrument)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS commercial_invoice_id UUID;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS commercial_invoice_issued_at TIMESTAMPTZ;

-- Payment instructions (seller's bank details for direct payment)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_bank_name TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_account_number TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_routing_number TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_swift_iban TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_account_name TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_instructions_set_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_instructions_set_by UUID;

-- Financing fork: true when financing_active status is set
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS financing_payment_active BOOLEAN DEFAULT FALSE;

-- Payment confirmation (buyer-side)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_confirmed_by UUID;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(20,4);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_currency TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_external_reference TEXT;

-- Overdue tracking
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_due_date DATE;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

-- Amendment history (JSONB array of amendment records)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS amendment_history JSONB DEFAULT '[]'::jsonb;

-- External counterparty details (for imported deals without Strike accounts)
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_counterparty_email TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_counterparty_name TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_counterparty_country TEXT;

-- Cancellation actor
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS cancelled_by UUID;

-- Dispute tracking
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS disputed_by UUID;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dispute_reason TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dispute_category TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dispute_resolved_by UUID;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dispute_resolution TEXT;

-- Confirmed timestamp
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS in_preparation_at TIMESTAMPTZ;

-- Deal events audit log
CREATE TABLE IF NOT EXISTS public.deal_events (
  id         UUID DEFAULT uuid_generate_v4() NOT NULL,
  deal_id    UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  actor_org_id  UUID,
  description   TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS deal_events_deal_id_idx ON public.deal_events (deal_id);
CREATE INDEX IF NOT EXISTS deal_events_created_at_idx ON public.deal_events (created_at DESC);

-- RLS on deal_events: org members can read events for deals they are party to
ALTER TABLE public.deal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read their deal events" ON public.deal_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
      JOIN public.users u ON u.org_id IN (d.buyer_org_id, d.supplier_org_id)
      WHERE d.id = deal_events.deal_id
        AND u.id = auth.uid()
    )
  );
