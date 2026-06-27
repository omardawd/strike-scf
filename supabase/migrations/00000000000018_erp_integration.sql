-- ERP Integration tables: erp_connections + erp_sync_data
-- Supports ERPNext (free), NetSuite, SAP, Oracle, Dynamics 365

CREATE TABLE erp_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  erp_type          TEXT        NOT NULL CHECK (erp_type IN ('erpnext','netsuite','sap','oracle','dynamics')),
  base_url          TEXT        NOT NULL,
  api_key           TEXT        NOT NULL,
  api_secret        TEXT        NOT NULL,
  dispatch_token    TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('pending','active','error','disconnected')),
  last_synced_at    TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE erp_sync_data (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  erp_connection_id   UUID        NOT NULL REFERENCES erp_connections(id) ON DELETE CASCADE,
  data_type           TEXT        NOT NULL
                                  CHECK (data_type IN (
                                    'cash_position','ar_aging','ap_aging',
                                    'inventory_levels','open_orders',
                                    'payment_terms','production_capacity'
                                  )),
  period_start        DATE,
  period_end          DATE,
  data                JSONB       NOT NULL DEFAULT '{}',
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, data_type)
);

-- Indexes
CREATE INDEX idx_erp_connections_org_id ON erp_connections(org_id);
CREATE INDEX idx_erp_sync_data_org_id ON erp_sync_data(org_id);
CREATE INDEX idx_erp_sync_data_org_type ON erp_sync_data(org_id, data_type);

-- RLS
ALTER TABLE erp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_sync_data   ENABLE ROW LEVEL SECURITY;

-- Org admins/members can read their own connection
CREATE POLICY "org_read_erp_connection"
  ON erp_connections FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM users WHERE id = auth.uid()
    )
  );

-- Only org_admin can insert/update/delete
CREATE POLICY "org_admin_write_erp_connection"
  ON erp_connections FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM users WHERE id = auth.uid() AND role = 'org_admin'
    )
  );

CREATE POLICY "org_read_erp_sync_data"
  ON erp_sync_data FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM users WHERE id = auth.uid()
    )
  );
